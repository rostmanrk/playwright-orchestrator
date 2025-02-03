import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { createPool, Pool, ResultSetHeader, RowDataPacket, SslOptions } from 'mysql2/promise';
import { TestRunReport } from '../../core/dist/types/reporter.js';

interface Test extends RowDataPacket {
    order_num: number;
    file: string;
    line: number;
    pos: number;
    project: string;
    timeout: number;
    report?: {
        title: string;
        status: TestStatus;
        ema: number;
        duration: number;
        lastSuccessfulRun: number;
        fails: number;
    };
}

interface Run extends RowDataPacket {
    id: number;
    status: number;
    updated: Date;
    config: any;
}

interface TestHistoryInfo extends RowDataPacket {
    id: number;
    ema: number;
    fails: number;
    lastSuccessfulRun: Date;
}

interface TestInfo extends RowDataPacket {
    id: number;
    ema: number;
    created: Date;
    name: string;
}

export class MySQLAdapter extends Adapter {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly testInfoTable: string;
    private readonly testInfoHistoryTable: string;
    private readonly pool: Pool;
    constructor(args: CreateArgs) {
        const { connectionString, tableNamePrefix } = args;
        super();
        const url = new URL(connectionString);
        if (url.protocol !== 'mysql:') throw new Error('Invalid connection string');
        this.pool = createPool({
            host: url.hostname,
            port: Number(url.port),
            user: url.username,
            password: url.password,
            database: url.pathname.substring(1),
            ssl: this.createSslConfig(args),
            multipleStatements: true,
        });
        this.configTable = `${tableNamePrefix}_test_runs`;
        this.testsTable = `${tableNamePrefix}_tests`;
        this.testInfoTable = `${tableNamePrefix}_tests_info`;
        this.testInfoHistoryTable = `${tableNamePrefix}_tests_info_history`;
    }

    private createSslConfig({
        sslCa,
        sslCert,
        sslKey,
        sslPassphrase,
        sslProfile,
        sslRejectUnauthorized,
        sslVerifyServerCertificate,
    }: CreateArgs): SslOptions | string | undefined {
        if (!sslCa && !sslCert && !sslKey && !sslProfile) return undefined;
        return (
            sslProfile ?? {
                ca: sslCa,
                cert: sslCert,
                key: sslKey,
                passphrase: sslPassphrase,
                rejectUnauthorized: sslRejectUnauthorized,
                verifyIdentity: sslVerifyServerCertificate,
            }
        );
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const client = await this.pool.getConnection();
        try {
            await client.beginTransaction();
            const [result] = await client.query<Test[][]>(
                `SET @order_num = (SELECT order_num FROM ??
                    WHERE run_id = UUID_TO_BIN(?) AND status = ?
                    ORDER BY order_num
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED);
                UPDATE ??
                SET status = ?, updated = CURRENT_TIMESTAMP
                WHERE run_id = UUID_TO_BIN(?) AND order_num = @order_num;
                
                SELECT * FROM ??
                WHERE run_id = UUID_TO_BIN(?) AND order_num = @order_num`,
                [
                    this.testsTable,
                    runId,
                    TestStatus.Ready,
                    this.testsTable,
                    TestStatus.Ongoing,
                    runId,
                    this.testsTable,
                    runId,
                ],
            );
            await client.commit();
            if (result[2].length === 0) return undefined;
            const { file, line, pos, project, timeout, order_num } = result[2][0];
            return { file, position: `${line}:${pos}`, project, timeout, order: order_num };
        } catch (e) {
            await client.rollback();
            throw e;
        } finally {
            client.release();
        }
    }
    async finishTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResult(TestStatus.Passed, params);
    }

    async failTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResult(TestStatus.Failed, params);
    }

    async saveTestRun({ runId, testRun, args, historyWindow }: SaveTestRunParams): Promise<void> {
        const tests = this.transformTestRunToItems(testRun.testRun);
        await this.loadTestInfos(tests);

        const testValues = tests.map(({ position, order, file, project, timeout }) => {
            const [line, character] = position.split(':');
            return [runId, order, file, +line, +character, project, timeout];
        });
        const values = [
            this.configTable,
            runId,
            RunStatus.Created,
            JSON.stringify({ ...testRun.config, args, historyWindow: historyWindow }),
            this.testsTable,
            ...testValues.flatMap((v) => v),
        ];
        await this.pool.query({
            sql: `
            INSERT INTO ?? (id, status, config) VALUES (UUID_TO_BIN(?), ?, ?);
            INSERT INTO ?? (run_id, order_num, file, line, pos, project, timeout) VALUES ${testValues
                .map(() => '(UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?)')
                .join(', ')}`,
            values: values,
        });
    }

    async initialize(): Promise<void> {
        await this.pool.query({
            sql: `CREATE TABLE IF NOT EXISTS ?? (
                id binary(16) PRIMARY KEY,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                config JSON NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ?? (
                run_id binary(16) NOT NULL,
                order_num INT NOT NULL,
                status INT NOT NULL DEFAULT 0,
                file TEXT NOT NULL,
                line INT NOT NULL,
                pos INT NOT NULL,
                project TEXT NOT NULL,
                timeout INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                report JSON,
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ??(id),
                INDEX idx_status (status)
            );
            CREATE TABLE IF NOT EXISTS ?? (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name TEXT NOT NULL,
                ema FLOAT NOT NULL,
                created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE INDEX idx_name (name(255))
            );
            CREATE TABLE IF NOT EXISTS ?? (
                id INT PRIMARY KEY AUTO_INCREMENT,
                duration FLOAT NOT NULL,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                test_info_id INT NOT NULL,
                FOREIGN KEY (test_info_id) REFERENCES ??(id),
                INDEX idx_test_info_id (test_info_id)
            );
            `,
            values: [
                this.configTable,
                this.testsTable,
                this.configTable,
                this.testInfoTable,
                this.testInfoHistoryTable,
                this.testInfoTable,
            ],
        });
    }
    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.pool.getConnection();
        let [result] = await client.query<Run[]>(
            `SELECT * FROM ??
            WHERE id = UUID_TO_BIN(?)
            FOR UPDATE
        `,
            [this.configTable, runId],
        );
        if (result.length === 0) {
            throw new Error(`Run ${runId} not found`);
        }
        try {
            await client.beginTransaction();
            const { updated: updatedBefore, status: statusBefore } = result[0];
            if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
                await client.query({
                    sql: `UPDATE ??
                    SET status = ?
                    WHERE run_id = UUID_TO_BIN(?) AND status = ? AND updated <= ?`,
                    values: [this.testsTable, TestStatus.Ready, runId, TestStatus.Failed, updatedBefore],
                });
                await client.query({
                    sql: `UPDATE ??
                    SET updated = CURRENT_TIMESTAMP,
                    status = CASE 
                        WHEN status = ? THEN ?
                        ELSE ?
                        END
                    WHERE id = UUID_TO_BIN(?)`,
                    values: [this.configTable, RunStatus.Created, RunStatus.Run, RunStatus.RepeatRun, runId],
                });
                [result] = await client.query<Run[]>(
                    `SELECT * FROM ??
                    WHERE id = UUID_TO_BIN(?)`,
                    [this.configTable, runId],
                );
                await client.commit();
            }
        } catch (e) {
            await client.rollback();
            throw e;
        }
        return this.mapConfig(result[0]);
    }

    async finishShard(runId: string): Promise<void> {
        // set 'updated' field to current time as test run exhausted all tests
        // update 'updated' field until last shard set correct finish time
        await this.pool.query(
            `UPDATE ??
            SET status = ?,
            updated = CURRENT_TIMESTAMP
            WHERE id = UUID_TO_BIN(?)`,
            [this.configTable, RunStatus.Finished, runId],
        );
    }

    async dispose(): Promise<void> {
        await this.pool.end();
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const [[run]] = await this.pool.query<Run[]>({
            sql: `SELECT * FROM ??
            WHERE id = UUID_TO_BIN(?)`,
            values: [this.configTable, runId],
        });
        if (!run) throw new Error(`Run ${runId} not found`);
        const [tests] = await this.pool.query<Test[]>({
            sql: `SELECT * FROM ??
            WHERE run_id = UUID_TO_BIN(?)`,
            values: [this.testsTable, runId],
        });

        return {
            runId,
            config: this.mapConfig(run),
            tests: tests.map(({ file, project, report, line, pos }) => {
                return {
                    averageDuration: report?.ema ?? 0,
                    file,
                    duration: report?.duration ?? 0,
                    fails: report?.fails ?? 0,
                    position: `${line}:${pos}`,
                    project,
                    status: report?.status ?? TestStatus.Ready,
                    title: report?.title ?? '',
                    lastSuccessfulRunTimestamp: report?.lastSuccessfulRun,
                };
            }),
        };
    }

    private async loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestInfo>> {
        const [results] = await this.pool.query<TestInfo[][]>({
            sql: `CREATE TEMPORARY TABLE temp_values (
                name TEXT NOT NULL,
                ema FLOAT DEFAULT 0,
                created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO temp_values (name)
            VALUES ${tests.map(() => '(?)').join(', ')};

            INSERT INTO ?? (name, ema, created)
            SELECT * FROM temp_values t WHERE NOT EXISTS (
                SELECT 1 FROM ??
                WHERE name = t.name
            );

            SELECT * FROM ?? WHERE name IN (SELECT name FROM temp_values);
            DROP TEMPORARY TABLE IF EXISTS temp_values;`,
            values: [...tests.map((t) => t.testId), this.testInfoTable, this.testInfoTable, this.testInfoTable],
        });
        const testInfoMap = new Map<string, TestInfo>();
        for (const test of results[3]) {
            testInfoMap.set(test.name, test);
        }
        return testInfoMap;
    }

    private async updateTestWithResult(
        status: TestStatus,
        { runId, test, testResult, config }: ResultTestParams,
    ): Promise<void> {
        const testId = this.getTestId({ ...test, ...testResult });
        const [[testInfo]] = await this.pool.query<TestHistoryInfo[]>({
            sql: `SELECT 
                id,
                ema,
                (
                    SELECT COUNT(*) FROM ?? 
                    WHERE status = ? AND test_info_id = info.id
                ) AS fails,
                (
                    SELECT updated FROM ?? 
                    WHERE status = ? AND test_info_id = info.id 
                    ORDER BY updated DESC LIMIT 1
                ) AS lastSuccessfulRun
            FROM ?? info
            WHERE info.name = ?`,
            values: [
                this.testInfoHistoryTable,
                TestStatus.Failed,
                this.testInfoHistoryTable,
                TestStatus.Passed,
                this.testInfoTable,
                testId,
            ],
        });
        const nextEma = this.calculateEMA(testResult.duration, testInfo.ema, config.historyWindow);

        await this.pool.query<ResultSetHeader>({
            sql: `UPDATE ??
            SET 
                status = ?, 
                updated = CURRENT_TIMESTAMP,
                report = JSON_SET(
                    COALESCE(report, '{}'),
                    '$.title', ?,
                    '$.duration', ?,
                    '$.fails', ?,
                    '$.ema', ?,
                    '$.lastSuccessfulRun', ?,
                    '$.status', ?
                )
            WHERE run_id = UUID_TO_BIN(?) AND order_num = ?;

            UPDATE ?? SET ema = ? WHERE id = ?;

            INSERT INTO ?? (duration, status, updated, test_info_id)
            VALUES (?, ?, CURRENT_TIMESTAMP, ?);
            
            DELETE main FROM ?? main
            INNER JOIN (
                SELECT id FROM ?? 
                WHERE test_info_id = ? 
                ORDER BY updated 
                LIMIT 10 OFFSET ${config.historyWindow}
            ) d ON d.id = main.id;`,
            values: [
                this.testsTable,
                status,
                testResult.title,
                testResult.duration,
                testInfo.fails,
                testInfo.ema,
                testInfo.lastSuccessfulRun?.getTime?.(),
                status,
                runId,
                test.order,
                this.testInfoTable,
                nextEma,
                testInfo.id,
                this.testInfoHistoryTable,
                testResult.duration,
                status,
                testInfo.id,
                this.testInfoHistoryTable,
                this.testInfoHistoryTable,
                testInfo.id,
            ],
        });
    }

    private mapConfig(dbValue: any): TestRunConfig {
        const { updated, status, config } = dbValue;
        return { ...config, updated: updated.getDate(), status } as TestRunConfig;
    }
}
