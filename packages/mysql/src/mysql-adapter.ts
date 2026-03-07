import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    ReporterTestItem,
    TestSortItem,
    TestRunReport,
    HistoryItem,
    TestReport,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { createPool, Pool, ResultSetHeader, RowDataPacket, SslOptions } from 'mysql2/promise';

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

interface TestInfo extends RowDataPacket {
    id: number;
    ema: number;
    created: Date;
    name: string;
    fails: number;
}

interface HistoryRow extends RowDataPacket {
    status: number;
    duration: number;
    updated: number;
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

    async loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
        if (!tests.length) {
            return new Map<string, TestSortItem>();
        }
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

            SELECT
                id,
                name,
                ema,
                created,
                (
                    SELECT COUNT(*) FROM ??
                    WHERE status = ? AND test_info_id = info.id
                ) AS fails
            FROM ?? info
            WHERE name IN (SELECT name FROM temp_values);

            DROP TEMPORARY TABLE IF EXISTS temp_values;`,
            values: [
                ...tests.map((t) => t.testId),
                this.testInfoTable,
                this.testInfoTable,
                this.testInfoHistoryTable,
                TestStatus.Failed,
                this.testInfoTable,
            ],
        });

        const testInfoMap = new Map<string, TestSortItem>();
        for (const test of results[3]) {
            testInfoMap.set(test.name, { ema: test.ema, fails: test.fails });
        }
        return testInfoMap;
    }

    async saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void> {
        const testValues = tests.map(({ position, order, file, project, timeout }) => {
            const [line, character] = position.split(':');
            return [runId, order, file, +line, +character, project, timeout];
        });
        if (!testValues.length) return;
        await this.pool.query<ResultSetHeader>({
            sql: `
            INSERT INTO ?? (id, status, config) VALUES (UUID_TO_BIN(?), ?, ?);
            INSERT INTO ?? (run_id, order_num, file, line, pos, project, timeout) VALUES ${testValues
                .map(() => '(UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?)')
                .join(', ')}`,
            values: [
                this.configTable,
                runId,
                RunStatus.Created,
                JSON.stringify(config),
                this.testsTable,
                ...testValues.flatMap((v) => v),
            ],
        });
    }

    async getTestEma(testId: string): Promise<number> {
        const [[testInfo]] = await this.pool.query<TestInfo[]>({
            sql: `SELECT ema FROM ?? WHERE name = ?`,
            values: [this.testInfoTable, testId],
        });
        return testInfo?.ema ?? 0;
    }

    async saveTestHistory(
        testId: string,
        item: HistoryItem,
        historyWindow: number,
        newEma: number,
    ): Promise<HistoryItem[]> {
        await this.pool.query<ResultSetHeader>({
            sql: `UPDATE ?? SET ema = ? WHERE name = ?;

            INSERT INTO ?? (duration, status, updated, test_info_id)
            SELECT ?, ?, CURRENT_TIMESTAMP, id FROM ?? WHERE name = ?;

            DELETE h FROM ?? h
            JOIN ?? t ON t.id = h.test_info_id
            WHERE t.name = ?
            AND h.id NOT IN (
                SELECT id FROM (
                    SELECT h2.id FROM ?? h2
                    JOIN ?? t2 ON t2.id = h2.test_info_id
                    WHERE t2.name = ?
                    ORDER BY h2.updated DESC
                    LIMIT ?
                ) AS keep_rows
            );
            `,
            values: [
                // UPDATE ?? SET ema = ? WHERE name = ?;
                this.testInfoTable,
                newEma,
                testId,
                // INSERT INTO ?? (duration, status, updated, test_info_id)
                this.testInfoHistoryTable,
                // SELECT ?, ?, CURRENT_TIMESTAMP, id FROM ?? WHERE name = ?;
                item.duration,
                item.status,
                this.testInfoTable,
                testId,
                // DELETE h FROM ?? h JOIN ?? t ...
                this.testInfoHistoryTable,
                this.testInfoTable,
                testId,
                // NOT IN (SELECT id FROM (SELECT h2.id FROM ?? h2 JOIN ?? t2 ...
                this.testInfoHistoryTable,
                this.testInfoTable,
                testId,
                historyWindow,
            ],
        });
        const [history] = await this.pool.query<HistoryRow[]>({
            sql: `SELECT h.status, h.duration, UNIX_TIMESTAMP(h.updated) * 1000 AS updated
                  FROM ?? h JOIN ?? t ON t.id = h.test_info_id
                  WHERE t.name = ? ORDER BY h.updated`,
            values: [this.testInfoHistoryTable, this.testInfoTable, testId],
        });
        return history.map((h) => ({ status: h.status as TestStatus, duration: h.duration, updated: h.updated }));
    }

    async saveTestRunReport(
        runId: string,
        testId: string,
        test: TestItem,
        report: TestReport,
        failed: boolean,
    ): Promise<void> {
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
            WHERE run_id = UUID_TO_BIN(?) AND order_num = ?`,
            values: [
                this.testsTable,
                report.status,
                report.title,
                report.duration,
                report.fails,
                report.averageDuration,
                report.lastSuccessfulRunTimestamp,
                report.status,
                runId,
                test.order,
            ],
        });
    }

    private mapConfig(dbValue: any): TestRunConfig {
        const { updated, status, config } = dbValue;
        return { ...config, updated: updated.getTime(), status } as TestRunConfig;
    }
}
