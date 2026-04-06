import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRunContext, TestShard } from '@playwright-orchestrator/core';
import { RunStatus, SYMBOLS, TestStatus } from '@playwright-orchestrator/core';
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
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
    ) {
        this.pool = pgPool.pool;
        this.configTable = pg.escapeIdentifier(`${tableNamePrefix}_test_runs`);
        this.testsTable = pg.escapeIdentifier(`${tableNamePrefix}_tests`);
    }
    async getNextTest(_config: TestRunConfig): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return this.claimNextTest(runId);
    }

    async getNextTestByProject(project: string): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return this.claimNextTest(runId, project);
    }

    private async claimNextTest(runId: string, project?: string): Promise<TestItem | undefined> {
        const projectFilter = project ? `AND projects @> to_jsonb(ARRAY[$4]::text[])` : '';
        const values = project
            ? [runId, TestStatus.Ready, TestStatus.Ongoing, project]
            : [runId, TestStatus.Ready, TestStatus.Ongoing];
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const result = await client.query({
                text: `WITH next_test AS (
                    SELECT order_num FROM ${this.testsTable}
                    WHERE run_id = $1 AND status = $2 ${projectFilter}
                    ORDER BY order_num
                    LIMIT 1
                    FOR UPDATE SKIP LOCKED
                )
                UPDATE ${this.testsTable} t
                SET status = $3, updated = NOW()
                FROM next_test
                WHERE t.run_id = $1 AND t.order_num = next_test.order_num
                RETURNING *`,
                values,
            });
            await client.query('COMMIT');
            if (result.rowCount === 0) return undefined;
            const { file, line, character, projects, timeout, ema, order_num, children, test_id } = result.rows[0];
            return {
                file,
                position: `${line}:${character}`,
                projects,
                timeout,
                ema,
                order: order_num,
                children,
                testId: test_id,
            };
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async startShard(): Promise<TestRunConfig> {
        const { runId, shardId } = this.runContext;
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
                await client.query({
                    text: `UPDATE ${this.configTable}
                    SET status = (CASE
                        WHEN status = $2 THEN ${RunStatus.Run}
                        ELSE ${RunStatus.RepeatRun}
                    END),
                    updated = NOW()
                    WHERE id = $1;`,
                    values: [runId, RunStatus.Created],
                });
            }
            await client.query({
                text: `UPDATE ${this.configTable}
                SET shards = jsonb_set(
                    shards,
                    $2,
                    jsonb_build_object('shardId', $3, 'started', (EXTRACT(EPOCH FROM NOW()) * 1000)::bigint)
                )
                WHERE id = $1 AND (shards->>$3 IS NULL);`,
                values: [runId, `{${shardId}}`, shardId],
            });
            await client.query('COMMIT');
            return result.rows[0].config;
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    async finishShard(): Promise<void> {
        const { runId, shardId } = this.runContext;
        await this.pool.query(
            `UPDATE ${this.configTable}
            SET status = $2,
            updated = NOW(),
            shards = jsonb_set(shards, $3, to_jsonb((EXTRACT(EPOCH FROM NOW()) * 1000)::bigint))
            WHERE id = $1 AND shards #>> $3::text[] IS NULL;`,
            [runId, RunStatus.Finished, `{${shardId},finished}`],
        );
    }
}
