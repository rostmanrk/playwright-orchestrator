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
        const projectFilter = project ? `AND meta->'projects' @> to_jsonb(ARRAY[$4]::text[])` : '';
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
            if (result.rowCount === 0) {
                await client.query('COMMIT');
                return undefined;
            }
            const { timeout, ema, order_num, test_id, meta } = result.rows[0];
            await client.query({
                text: `UPDATE ${this.configTable}
                SET config = jsonb_set(jsonb_set(config,
                    '{remainingCount}', ((config->>'remainingCount')::bigint - 1)::text::jsonb),
                    '{remainingTime}', ((config->>'remainingTime')::float - $2)::text::jsonb)
                WHERE id = $1`,
                values: [runId, ema],
            });
            await client.query('COMMIT');
            return {
                timeout,
                ema,
                order: order_num,
                testId: test_id,
                meta,
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
                if (statusBefore === RunStatus.Finished) {
                    await client.query({
                        text: `UPDATE ${this.configTable}
                        SET config = jsonb_set(jsonb_set(config,
                            '{remainingCount}', (SELECT COUNT(*) FROM ${this.testsTable} WHERE run_id = $1 AND status = ${TestStatus.Ready})::text::jsonb),
                            '{remainingTime}', (SELECT COALESCE(SUM(ema), 0) FROM ${this.testsTable} WHERE run_id = $1 AND status = ${TestStatus.Ready})::text::jsonb)
                        WHERE id = $1`,
                        values: [runId],
                    });
                }
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

    async getRemainingCounters(_config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }> {
        const { runId } = this.runContext;
        const result = await this.pool.query({
            text: `SELECT config->>'remainingCount' AS remaining_count, config->>'remainingTime' AS remaining_time FROM ${this.configTable} WHERE id = $1`,
            values: [runId],
        });
        if (result.rowCount === 0) return { remainingCount: 0, remainingTime: 0 };
        const { remaining_count, remaining_time } = result.rows[0];
        return {
            remainingCount: Math.max(0, Number(remaining_count ?? 0)),
            remainingTime: Math.max(0, Number(remaining_time ?? 0)),
        };
    }
}
