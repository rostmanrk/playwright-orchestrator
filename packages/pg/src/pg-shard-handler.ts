import { injectable, inject } from 'inversify';
import type { ShardHandler } from '@playwright-orchestrator/core';
import { RunStatus, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { PgPool } from './pg-pool.js';
import pg from 'pg';
import { PG_CONFIG, PG_POOL } from './symbols.js';

@injectable()
export class PgShardHandler implements ShardHandler {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly pool: pg.Pool;

    constructor(
        @inject(PG_CONFIG) { tableNamePrefix }: CreateArgs,
        @inject(PG_POOL) pgPool: PgPool,
    ) {
        this.pool = pgPool.pool;
        this.configTable = pg.escapeIdentifier(`${tableNamePrefix}_test_runs`);
        this.testsTable = pg.escapeIdentifier(`${tableNamePrefix}_tests`);
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
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
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            let result = await client.query({
                text: `SELECT * FROM ${this.configTable} WHERE id = $1 FOR UPDATE`,
                values: [runId],
            });
            if (result.rowCount === 0) {
                throw new Error(`Run ${runId} not found`);
            }
            const { updated: updatedBefore, status: statusBefore } = result.rows[0];
            if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
                await client.query({
                    text: `UPDATE ${this.testsTable}
                    SET updated = NOW(), status = $3
                    WHERE run_id = $1 AND status = $2 AND updated <= $4;`,
                    values: [runId, TestStatus.Failed, TestStatus.Ready, updatedBefore],
                });
                result = await client.query({
                    text: `UPDATE ${this.configTable}
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
        await this.pool.query({
            text: `UPDATE ${this.configTable} SET status = $1, updated = NOW() WHERE id = $2`,
            values: [RunStatus.Finished, runId],
        });
    }

    private mapConfig(dbConfig: any): TestRunConfig {
        return { ...dbConfig.config, updated: dbConfig.updated.getTime(), status: dbConfig.status };
    }
}
