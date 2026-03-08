import { injectable, inject } from 'inversify';
import type { ShardHandler } from '@playwright-orchestrator/core';
import { RunStatus, TestStatus } from '@playwright-orchestrator/core';
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
}

interface Run extends RowDataPacket {
    id: number;
    status: number;
    updated: Date;
    config: any;
}

@injectable()
export class MySQLShardHandler implements ShardHandler {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly pool: Pool;

    constructor(
        @inject(MYSQL_CONFIG) { tableNamePrefix }: CreateArgs,
        @inject(MYSQL_POOL) mysqlPool: MySQLPool,
    ) {
        this.pool = mysqlPool.pool;
        this.configTable = `${tableNamePrefix}_test_runs`;
        this.testsTable = `${tableNamePrefix}_tests`;
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
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
                    this.testsTable, runId, TestStatus.Ready,
                    this.testsTable, TestStatus.Ongoing, runId,
                    this.testsTable, runId,
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

    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.pool.getConnection();
        let [result] = await client.query<Run[]>(
            `SELECT * FROM ?? WHERE id = UUID_TO_BIN(?) FOR UPDATE`,
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
                    sql: `UPDATE ?? SET status = ? WHERE run_id = UUID_TO_BIN(?) AND status = ? AND updated <= ?`,
                    values: [this.testsTable, TestStatus.Ready, runId, TestStatus.Failed, updatedBefore],
                });
                await client.query({
                    sql: `UPDATE ?? SET updated = CURRENT_TIMESTAMP, status = CASE WHEN status = ? THEN ? ELSE ? END WHERE id = UUID_TO_BIN(?)`,
                    values: [this.configTable, RunStatus.Created, RunStatus.Run, RunStatus.RepeatRun, runId],
                });
                [result] = await client.query<Run[]>(
                    `SELECT * FROM ?? WHERE id = UUID_TO_BIN(?)`,
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
        await this.pool.query(
            `UPDATE ?? SET status = ?, updated = CURRENT_TIMESTAMP WHERE id = UUID_TO_BIN(?)`,
            [this.configTable, RunStatus.Finished, runId],
        );
    }

    private mapConfig(dbValue: any): TestRunConfig {
        const { updated, status, config } = dbValue;
        return { ...config, updated: updated.getTime(), status } as TestRunConfig;
    }
}
