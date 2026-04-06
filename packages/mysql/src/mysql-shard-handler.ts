import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRunContext, TestShard } from '@playwright-orchestrator/core';
import { RunStatus, SYMBOLS, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MySQLPool } from './mysql-pool.js';
import { Pool, RowDataPacket } from 'mysql2/promise';
import { MYSQL_CONFIG, MYSQL_POOL } from './symbols.js';

interface Test extends RowDataPacket {
    order_num: number;
    file: string;
    line: number;
    pos: number;
    project: string;
    timeout: number;
    ema: number;
    children?: string[];
    test_id: string;
}

interface Run extends RowDataPacket {
    id: number;
    status: number;
    updated: Date;
    config: TestRunConfig;
    shards: Record<string, TestShard>;
}

@injectable()
export class MySQLShardHandler implements ShardHandler {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly pool: Pool;

    constructor(
        @inject(MYSQL_CONFIG) { tableNamePrefix }: CreateArgs,
        @inject(MYSQL_POOL) mysqlPool: MySQLPool,
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
    ) {
        this.pool = mysqlPool.pool;
        this.configTable = `${tableNamePrefix}_test_runs`;
        this.testsTable = `${tableNamePrefix}_tests`;
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
        const projectFilter = project ? `AND JSON_CONTAINS(projects, JSON_QUOTE(?))` : '';
        const filterParams = project ? [project] : [];
        const client = await this.pool.getConnection();
        try {
            await client.beginTransaction();
            const [result] = await client.query<Test[][]>(
                `SET @order_num = (SELECT order_num FROM ??
                    WHERE run_id = UUID_TO_BIN(?) AND status = ? ${projectFilter}
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
                    ...filterParams,
                    this.testsTable,
                    TestStatus.Ongoing,
                    runId,
                    this.testsTable,
                    runId,
                ],
            );
            await client.commit();
            if (result[2].length === 0) return undefined;
            const { file, line, pos, projects, timeout, ema, order_num, children, test_id } = result[2][0];
            return {
                file,
                position: `${line}:${pos}`,
                projects,
                timeout,
                ema,
                order: order_num,
                children,
                testId: test_id,
            };
        } catch (e) {
            await client.rollback();
            throw e;
        } finally {
            client.release();
        }
    }

    async startShard(): Promise<TestRunConfig> {
        const { runId, shardId } = this.runContext;
        const client = await this.pool.getConnection();
        const shardPath = `$."${shardId}"`;
        try {
            await client.beginTransaction();
            let [result] = await client.query<Run[]>(`SELECT * FROM ?? WHERE id = UUID_TO_BIN(?) FOR UPDATE`, [
                this.configTable,
                runId,
            ]);
            if (result.length === 0) {
                throw new Error(`Run ${runId} not found`);
            }
            const { updated: updatedBefore, status: statusBefore } = result[0];
            if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
                await client.query({
                    sql: `UPDATE ?? SET status = ? WHERE run_id = UUID_TO_BIN(?) AND status = ? AND updated <= ?`,
                    values: [this.testsTable, TestStatus.Ready, runId, TestStatus.Failed, updatedBefore],
                });
                await client.query({
                    sql: `UPDATE ?? SET updated = CURRENT_TIMESTAMP, status = CASE WHEN status = ? THEN ? ELSE ? END WHERE id = UUID_TO_BIN(?)`,
                    values: [this.configTable, RunStatus.Created, RunStatus.Run, RunStatus.RepeatRun, runId],
                });
            }
            await client.query({
                sql: `UPDATE ??
                    SET shards = JSON_SET(shards, ?, JSON_OBJECT('shardId', ?, 'started', ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000)))
                    WHERE id = UUID_TO_BIN(?) AND JSON_EXTRACT(shards, ?) IS NULL`,
                values: [this.configTable, shardPath, shardId, runId, shardPath],
            });
            [result] = await client.query<Run[]>(`SELECT * FROM ?? WHERE id = UUID_TO_BIN(?)`, [
                this.configTable,
                runId,
            ]);
            await client.commit();
            return result[0].config;
        } catch (e) {
            await client.rollback();
            throw e;
        } finally {
            client.release();
        }
    }

    async finishShard(): Promise<void> {
        const { runId, shardId } = this.runContext;
        const shardFinishedPath = `$."${shardId}".finished`;
        await this.pool.query(
            `UPDATE ??
                SET status = ?, updated = CURRENT_TIMESTAMP, shards = JSON_SET(shards, ?, ROUND(UNIX_TIMESTAMP(NOW(3)) * 1000))
                WHERE id = UUID_TO_BIN(?) AND JSON_EXTRACT(COALESCE(shards, JSON_OBJECT()), ?) IS NULL`,
            [this.configTable, RunStatus.Finished, shardFinishedPath, runId, shardFinishedPath],
        );
    }
}
