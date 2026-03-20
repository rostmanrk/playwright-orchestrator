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
    ema: number;
    children?: string[];
    test_id: string;
}

interface Run extends RowDataPacket {
    id: number;
    status: number;
    updated: Date;
    config: TestRunConfig;
}

@injectable()
export class MySQLShardHandler implements ShardHandler {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly pool: Pool;

    constructor(@inject(MYSQL_CONFIG) { tableNamePrefix }: CreateArgs, @inject(MYSQL_POOL) mysqlPool: MySQLPool) {
        this.pool = mysqlPool.pool;
        this.configTable = `${tableNamePrefix}_test_runs`;
        this.testsTable = `${tableNamePrefix}_tests`;
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
        return this.claimNextTest(runId);
    }

    async getNextTestByProject(runId: string, project: string): Promise<TestItem | undefined> {
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

    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.pool.getConnection();
        let [result] = await client.query<Run[]>(`SELECT * FROM ?? WHERE id = UUID_TO_BIN(?) FOR UPDATE`, [
            this.configTable,
            runId,
        ]);
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
                [result] = await client.query<Run[]>(`SELECT * FROM ?? WHERE id = UUID_TO_BIN(?)`, [
                    this.configTable,
                    runId,
                ]);
            }
            await client.commit();
        } catch (e) {
            await client.rollback();
            throw e;
        } finally {
            client.release();
        }
        return result[0].config;
    }

    async finishShard(runId: string): Promise<void> {
        await this.pool.query(`UPDATE ?? SET status = ?, updated = CURRENT_TIMESTAMP WHERE id = UUID_TO_BIN(?)`, [
            this.configTable,
            RunStatus.Finished,
            runId,
        ]);
    }
}
