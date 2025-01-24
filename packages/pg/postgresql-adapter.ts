import { TestItem, TestRunInfo, Adapter, TestRunConfig, RunStatus, TestStatus } from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args';
import { Pool, PoolConfig, escapeIdentifier } from 'pg';

export class PostgreSQLAdapter extends Adapter {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly pool: Pool;
    constructor({ connectionString, tableNamePrefix, sslCa, sslCert, sslKey }: CreateArgs) {
        super();
        const config: PoolConfig = { connectionString };
        config.ssl = sslCa || sslCert || sslKey ? {} : undefined;
        if (sslCa) {
            config.ssl!.ca = sslCa;
        }
        if (sslCert && sslKey) {
            config.ssl!.cert = sslCert;
            config.ssl!.key = sslKey;
        }
        this.pool = new Pool(config);
        this.configTable = escapeIdentifier(`${tableNamePrefix}_test_runs`);
        this.testsTable = escapeIdentifier(`${tableNamePrefix}_tests`);
    }
    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query({
                name: 'select-next-test',
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
    async finishTest(runId: string, test: TestItem): Promise<void> {
        await this.updateTestStatus(runId, test, TestStatus.Passed);
    }
    async failTest(runId: string, test: TestItem): Promise<void> {
        await this.updateTestStatus(runId, test, TestStatus.Failed);
    }

    private async updateTestStatus(runId: string, test: TestItem, status: TestStatus): Promise<void> {
        await this.pool.query({
            name: 'update-test-status',
            text: `UPDATE ${this.testsTable}
            SET status = $1, updated = NOW()
            WHERE run_id = $2 AND order_num = $3`,
            values: [status, runId, test.order],
        });
    }

    async saveTestRun(runId: string, testRun: TestRunInfo, args: string[]): Promise<void> {
        await this.pool.query({
            name: 'insert-config',
            text: `INSERT INTO ${this.configTable} (id, status, config) VALUES ($1, $2, $3)`,
            values: [runId, RunStatus.Created, JSON.stringify({ ...testRun.config, args })],
        });
        const tests = this.flattenTestRun(testRun.testRun);
        const fields = ['order_num', 'file', 'line', 'character', 'project', 'timeout'];
        await this.pool.query({
            name: 'insert-tests',
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
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ${this.configTable}(id)
            );
            CREATE INDEX IF NOT EXISTS status_idx ON ${this.testsTable}(status);`,
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
            const { updated, status, config } = result.rows[0];
            const mappedConfig = { ...config, updated: updated.getTime(), status };

            return mappedConfig;
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
            name: 'update-finish-config',
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
}
