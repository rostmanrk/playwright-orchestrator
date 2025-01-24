import { TestItem, TestRunInfo, Adapter, TestRunConfig, RunStatus, TestStatus } from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args';
import { createPool, Pool, RowDataPacket, SslOptions } from 'mysql2/promise';

interface Test extends RowDataPacket {
    order_num: number;
    file: string;
    line: number;
    pos: number;
    project: string;
    timeout: number;
}

interface Run extends RowDataPacket {
    id: number;
    status: number;
    updated: Date;
    config: any;
}

export class MySQLAdapter extends Adapter {
    private readonly configTable: string;
    private readonly testsTable: string;
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
    async finishTest(runId: string, test: TestItem): Promise<void> {
        await this.updateTestStatus(runId, test, TestStatus.Passed);
    }
    async failTest(runId: string, test: TestItem): Promise<void> {
        await this.updateTestStatus(runId, test, TestStatus.Failed);
    }

    private async updateTestStatus(runId: string, test: TestItem, status: TestStatus): Promise<void> {
        await this.pool.query({
            sql: `UPDATE ??
            SET status = ?, updated = CURRENT_TIMESTAMP
            WHERE run_id = UUID_TO_BIN(?) AND order_num = ?`,
            values: [this.testsTable, status, runId, test.order],
        });
    }

    async saveTestRun(runId: string, testRun: TestRunInfo, args: string[]): Promise<void> {
        const tests = this.flattenTestRun(testRun.testRun);

        const testValues = tests.map(({ position, order, file, project, timeout }) => {
            const [line, character] = position.split(':');
            return [runId, order, file, +line, +character, project, timeout];
        });
        const values = [
            this.configTable,
            runId,
            RunStatus.Created,
            JSON.stringify({ ...testRun.config, args }),
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
        const indexName = `idx_status`;
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
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ??(id)
            );
            CREATE PROCEDURE CreateIndexIfNotExists()
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 
                    FROM information_schema.statistics 
                    WHERE table_schema = DATABASE()
                    AND table_name = ?
                    AND index_name = ?
                ) THEN
                    CREATE INDEX ?? ON ??(status);
                END IF;
            END;

            CALL CreateIndexIfNotExists();
            DROP PROCEDURE CreateIndexIfNotExists;`,
            values: [
                this.configTable,
                this.testsTable,
                this.configTable,
                this.testsTable,
                indexName,
                indexName,
                this.testsTable,
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
        const { updated, status, config } = result[0];
        const mappedConfig = { ...config, updated: updated.getDate(), status };
        return mappedConfig;
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
}
