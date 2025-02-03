import {
    TestItem,
    TestRunInfo,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import pg from 'pg';
import { TestRunReport } from '../../core/dist/types/reporter.js';

interface TestInfo {
    id: number;
    name: string;
    ema: number;
    created: Date;
}

export class PostgreSQLAdapter extends Adapter {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly testInfoTable: string;
    private readonly testInfoHistoryTable: string;
    private readonly pool: pg.Pool;
    constructor({ connectionString, tableNamePrefix, sslCa, sslCert, sslKey }: CreateArgs) {
        super();
        const config: pg.PoolConfig = { connectionString };
        config.ssl = sslCa || sslCert || sslKey ? {} : undefined;
        if (sslCa) {
            config.ssl!.ca = sslCa;
        }
        if (sslCert && sslKey) {
            config.ssl!.cert = sslCert;
            config.ssl!.key = sslKey;
        }
        this.pool = new pg.Pool(config);
        this.configTable = pg.escapeIdentifier(`${tableNamePrefix}_test_runs`);
        this.testsTable = pg.escapeIdentifier(`${tableNamePrefix}_tests`);
        this.testInfoTable = pg.escapeIdentifier(`${tableNamePrefix}_test_info`);
        this.testInfoHistoryTable = pg.escapeIdentifier(`${tableNamePrefix}_test_info_history`);
    }
    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query({
                text: `WITH next_test AS (
                    SELECT order_num FROM ${this.testsTable}
                    WHERE run_id = $1 AND status = $2
                    ORDER BY order_num
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE ${this.testsTable} t
                SET status = $3, updated = NOW()
                FROM next_test
                WHERE t.run_id = $1 AND t.order_num = next_test.order_num
                RETURNING *`,
                values: [runId, TestStatus.Ready, TestStatus.Ongoing],
            });
            await client.query('COMMIT');
            if (result.rowCount === 0) return undefined;
            const { file, line, character, project, timeout, order_num } = result.rows[0];
            return { file, position: `${line}:${character}`, project, timeout, order: order_num };
        } catch (e) {
            await this.pool.query('ROLLBACK');
        } finally {
            client.release();
        }
    }

    async finishTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResults(TestStatus.Passed, params);
    }
    async failTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResults(TestStatus.Failed, params);
    }
    async saveTestRun({ runId, args, historyWindow, testRun }: SaveTestRunParams): Promise<void> {
        await this.loadTestInfos(this.transformTestRunToItems(testRun.testRun));
        await this.pool.query({
            text: `INSERT INTO ${this.configTable} (id, status, config) VALUES ($1, $2, $3)`,
            values: [runId, RunStatus.Created, JSON.stringify({ ...testRun.config, args, historyWindow })],
        });
        const tests = this.transformTestRunToItems(testRun.testRun);
        const fields = ['order_num', 'file', 'line', 'character', 'project', 'timeout'];
        await this.pool.query({
            text: `INSERT INTO ${this.testsTable} (run_id, ${fields.join(', ')}) VALUES ${tests
                .map((_, i) => {
                    const len = fields.length;
                    const values = fields.map((_, j) => `$${i * len + j + 2}`).join(', ');
                    return `($1, ${values})`;
                })
                .join(', ')}`,
            values: [
                runId,
                ...tests.flatMap(({ position, order, file, project, timeout }) => {
                    const [line, character] = position.split(':');
                    return [order, file, line, character, project, timeout];
                }),
            ],
        });
    }
    async initialize(): Promise<void> {
        await this.pool.query(
            `CREATE TABLE IF NOT EXISTS ${this.configTable} (
                id UUID PRIMARY KEY,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                config JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ${this.testsTable} (
                run_id UUID NOT NULL,
                order_num INT NOT NULL,
                status INT NOT NULL DEFAULT 0,
                file TEXT NOT NULL,
                line INT NOT NULL,
                character INT NOT NULL,
                project TEXT NOT NULL,
                timeout INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                report JSONB,
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ${this.configTable}(id)
            );
            CREATE INDEX IF NOT EXISTS status_idx ON ${this.testsTable}(status);
            CREATE TABLE IF NOT EXISTS ${this.testInfoTable} (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                ema FLOAT NOT NULL DEFAULT 0,
                created TIMESTAMP NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS name_idx ON ${this.testInfoTable} USING HASH (name);
            CREATE TABLE IF NOT EXISTS ${this.testInfoHistoryTable} (
                id SERIAL PRIMARY KEY,
                duration FLOAT NOT NULL,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                test_info_id INT NOT NULL,
                FOREIGN KEY (test_info_id) REFERENCES ${this.testInfoTable}(id)
            );
            CREATE INDEX IF NOT EXISTS test_info_id_idx ON ${this.testInfoHistoryTable}(test_info_id);`,
        );
    }
    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            let result = await client.query({
                text: `
                    SELECT *
                    FROM ${this.configTable}
                    WHERE id = $1
                    FOR UPDATE`,
                values: [runId],
            });
            if (result.rowCount === 0) {
                throw new Error(`Run ${runId} not found`);
            }
            const { updated: updatedBefore, status: statusBefore } = result.rows[0];
            if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
                await client.query({
                    text: `
                    UPDATE ${this.testsTable}
                    SET updated = NOW(), status = $3
                    WHERE run_id = $1 AND status = $2 AND updated <= $4;`,
                    values: [runId, TestStatus.Failed, TestStatus.Ready, updatedBefore],
                });
                // using str interpolation for case statement to avoid casting ints to strings
                result = await client.query({
                    text: `
                    UPDATE ${this.configTable}
                    SET status = (CASE
                        WHEN status = $2 THEN ${RunStatus.Run}
                        ELSE ${RunStatus.RepeatRun}
                    END),
                    updated = NOW()
                    WHERE id = $1
                    RETURNING *;`,
                    values: [runId, RunStatus.Created],
                });
            }

            await client.query('COMMIT');
            return this.mapConfig(result.rows[0]);
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async finishShard(runId: string): Promise<void> {
        // set 'updated' field to current time as test run exhausted all tests
        // update 'updated' field until last shard set correct finish time
        await this.pool.query({
            text: `UPDATE ${this.configTable}
            SET status = $1,
            updated = NOW()
            WHERE id = $2`,
            values: [RunStatus.Finished, runId],
        });
    }

    async dispose(): Promise<void> {
        if (this.pool.ending) return;
        await this.pool.end();
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const {
            rows: [dbConfig],
        } = await this.pool.query({
            text: `SELECT * FROM ${this.configTable} WHERE id = $1`,
            values: [runId],
        });
        if (!dbConfig) throw new Error(`Run ${runId} not found`);
        const { rows } = await this.pool.query({
            text: `SELECT * FROM ${this.testsTable} WHERE run_id = $1`,
            values: [runId],
        });
        return {
            runId,
            config: this.mapConfig(dbConfig),
            tests: rows.map(({ file, project, line, character, report }) => ({
                averageDuration: 0,
                duration: report?.duration ?? 0,
                status: report?.status ?? TestStatus.Ready,
                fails: report?.fails ?? 0,
                file,
                position: `${line}:${character}`,
                project,
                title: report?.title,
                lastSuccessfulRunTimestamp: report?.lastSuccessfulRun,
            })),
        };
    }

    private async updateTestWithResults(
        status: TestStatus,
        { runId, test, config, testResult }: ResultTestParams,
    ): Promise<void> {
        const testId = this.getTestId({ ...test, ...testResult });
        const {
            rows: [testInfo],
        } = await this.pool.query({
            text: `SELECT 
                id, 
                ema,
                (
                    SELECT COUNT(*) FROM ${this.testInfoHistoryTable} 
                    WHERE status = ${TestStatus.Failed} AND test_info_id = info.id
                ) AS fails,
                (
                    SELECT updated FROM ${this.testInfoHistoryTable} 
                    WHERE status = ${TestStatus.Passed} AND test_info_id = info.id 
                    ORDER BY updated DESC LIMIT 1
                ) AS last_successful_run
            FROM ${this.testInfoTable} info
            WHERE name = $1`,
            values: [testId],
        });
        const report = {
            title: testResult.title,
            status,
            duration: testResult.duration,
            ema: testInfo.ema,
            fails: +testInfo.fails,
            lastSuccessfulRun: testInfo.last_successful_run?.getTime?.(),
        };

        const newEma = this.calculateEMA(testResult.duration, testInfo.ema, config.historyWindow);
        await this.pool.query({
            text: `UPDATE ${this.testsTable}
            SET 
                status = $1,
                updated = NOW(),
                report = $2 
            WHERE run_id = $3 AND order_num = $4;`,
            values: [status, report, runId, test.order],
        });
        await this.pool.query({
            text: `UPDATE ${this.testInfoTable} SET ema = $1 WHERE id = $2;`,
            values: [newEma, testInfo.id],
        });
        await this.pool.query({
            text: `INSERT INTO ${this.testInfoHistoryTable} (status, duration, updated, test_info_id)
            VALUES ($1, $2, NOW(), $3);`,
            values: [status, testResult.duration, testInfo.id],
        });
        await this.pool.query({
            text: `DELETE FROM ${this.testInfoHistoryTable}
            WHERE id IN (
                SELECT id 
                FROM ${this.testInfoHistoryTable}
                WHERE test_info_id = $1
                ORDER BY updated
                LIMIT 10
                OFFSET 10
            )`,
            values: [testInfo.id],
        });
    }

    private async loadTestInfos(tests: ReporterTestItem[]) {
        const results = await this.pool.query({
            text: `
            WITH test_names AS (
                SELECT UNNEST($1::TEXT[]) AS name
            )
            INSERT INTO ${this.testInfoTable} (name)
            SELECT name FROM test_names
            RETURNING *`,
            values: [tests.map((t) => t.testId)],
        });
        const testInfo = new Map<string, TestInfo>();
        for (const { id, name, ema, created } of results.rows) {
            testInfo.set(name, { id, name, ema, created });
        }
        return testInfo;
    }

    private mapConfig(dbConfig: any): TestRunConfig {
        return {
            ...dbConfig.config,
            updated: dbConfig.updated.getTime(),
            status: dbConfig.status,
        };
    }
}
