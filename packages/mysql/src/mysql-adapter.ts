import {
    BaseAdapter,
    TestRunConfig,
    TestStatus,
    TestRunReport,
    HistoryItem,
    SaveTestResultParams,
} from '@playwright-orchestrator/core';
import { injectable, inject } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { MySQLPool } from './mysql-pool.js';
import { Pool, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { MYSQL_CONFIG, MYSQL_POOL } from './symbols.js';

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

@injectable()
export class MySQLAdapter extends BaseAdapter {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly testInfoTable: string;
    private readonly testInfoHistoryTable: string;
    private readonly pool: Pool;

    constructor(
        @inject(MYSQL_CONFIG) { tableNamePrefix }: CreateArgs,
        @inject(MYSQL_POOL) mysqlPool: MySQLPool,
    ) {
        super();
        this.pool = mysqlPool.pool;
        this.configTable = `${tableNamePrefix}_test_runs`;
        this.testsTable = `${tableNamePrefix}_tests`;
        this.testInfoTable = `${tableNamePrefix}_tests_info`;
        this.testInfoHistoryTable = `${tableNamePrefix}_tests_info_history`;
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

    async getTestEma(testId: string): Promise<number> {
        const [[testInfo]] = await this.pool.query<TestInfo[]>({
            sql: `SELECT ema FROM ?? WHERE name = ?`,
            values: [this.testInfoTable, testId],
        });
        return testInfo?.ema ?? 0;
    }

    async saveTestResult({
        runId,
        testId,
        test,
        item,
        historyWindow,
        newEma,
        title,
    }: SaveTestResultParams): Promise<void> {
        const client = await this.pool.getConnection();
        try {
        await client.beginTransaction();
        await client.query<ResultSetHeader>({
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
        const [history] = await client.query<HistoryRow[]>({
            sql: `SELECT h.status, h.duration, UNIX_TIMESTAMP(h.updated) * 1000 AS updated
                  FROM ?? h JOIN ?? t ON t.id = h.test_info_id
                  WHERE t.name = ? ORDER BY h.updated`,
            values: [this.testInfoHistoryTable, this.testInfoTable, testId],
        });
        const historyItems = history.map((h) => ({
            status: h.status as TestStatus,
            duration: h.duration,
            updated: h.updated,
        }));
        const report = this.buildReport(test, item, title, newEma, historyItems);
        await client.query<ResultSetHeader>({
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
        await client.commit();
        } finally {
            client.release();
        }
    }

    private mapConfig(dbValue: any): TestRunConfig {
        const { updated, status, config } = dbValue;
        return { ...config, updated: updated.getTime(), status } as TestRunConfig;
    }
}
