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
import { PgPool } from './pg-pool.js';
import pg from 'pg';
import { PG_CONFIG, PG_POOL } from './symbols.js';

@injectable()
export class PostgreSQLAdapter extends BaseAdapter {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly testInfoTable: string;
    private readonly testInfoHistoryTable: string;
    private readonly pool: pg.Pool;

    constructor(@inject(PG_CONFIG) { tableNamePrefix }: CreateArgs, @inject(PG_POOL) pgPool: PgPool) {
        super();
        this.pool = pgPool.pool;
        this.configTable = pg.escapeIdentifier(`${tableNamePrefix}_test_runs`);
        this.testsTable = pg.escapeIdentifier(`${tableNamePrefix}_tests`);
        this.testInfoTable = pg.escapeIdentifier(`${tableNamePrefix}_test_info`);
        this.testInfoHistoryTable = pg.escapeIdentifier(`${tableNamePrefix}_test_info_history`);
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const {
            rows: [dbConfig],
        } = await this.pool.query({
            text: `SELECT * FROM ${this.configTable} WHERE id = $1`,
            values: [runId],
        });
        if (!dbConfig) throw new Error(`Run ${runId} not found`);
        const { rows } = await this.pool.query({
            text: `SELECT * FROM ${this.testsTable} WHERE run_id = $1`,
            values: [runId],
        });
        return {
            runId,
            config: this.mapConfig(dbConfig),
            tests: rows.map(({ file, projects, line, character, report }) => ({
                averageDuration: report?.ema ?? 0,
                duration: report?.duration ?? 0,
                status: report?.status ?? TestStatus.Ready,
                fails: report?.fails ?? 0,
                file,
                position: `${line}:${character}`,
                projects,
                title: report?.title,
                lastSuccessfulRunTimestamp: report?.lastSuccessfulRun,
            })),
        };
    }

    async getTestEma(testId: string): Promise<number> {
        const {
            rows: [testInfo],
        } = await this.pool.query({
            text: `SELECT ema FROM ${this.testInfoTable} WHERE name = $1`,
            values: [testId],
        });
        return testInfo?.ema ?? 0;
    }

    async saveTestResult({ runId, test, item, historyWindow, newEma }: SaveTestResultParams): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            const {
                rows: [{ id }],
            } = await client.query({
                text: `UPDATE ${this.testInfoTable} SET ema = $1 WHERE name = $2 RETURNING id`,
                values: [newEma, test.testId],
            });
            await client.query({
                text: `INSERT INTO ${this.testInfoHistoryTable} (status, duration, updated, test_info_id) VALUES ($1, $2, NOW(), $3)`,
                values: [item.status, item.duration, id],
            });
            await client.query({
                text: `DELETE FROM ${this.testInfoHistoryTable}
                WHERE id IN (
                    SELECT id
                    FROM ${this.testInfoHistoryTable}
                    WHERE test_info_id = $1
                    ORDER BY updated
                    LIMIT GREATEST(0, (SELECT COUNT(*) FROM ${this.testInfoHistoryTable} WHERE test_info_id = $1) - $2)
                )`,
                values: [id, historyWindow],
            });
            const { rows } = await client.query({
                text: `SELECT status, duration, EXTRACT(EPOCH FROM updated) * 1000 AS updated
                       FROM ${this.testInfoHistoryTable} WHERE test_info_id = $1 ORDER BY updated`,
                values: [id],
            });
            const history: HistoryItem[] = rows.map(({ status, duration, updated }) => ({
                status: +status as TestStatus,
                duration,
                updated: +updated,
            }));
            const report = this.buildReport(test, item, newEma, history);
            await client.query({
                text: `UPDATE ${this.testsTable}
                SET status = $1, updated = NOW(), report = $2
                WHERE run_id = $3 AND order_num = $4`,
                values: [
                    report.status,
                    {
                        title: report.title,
                        status: report.status,
                        duration: report.duration,
                        ema: report.averageDuration,
                        fails: report.fails,
                        lastSuccessfulRun: report.lastSuccessfulRunTimestamp,
                    },
                    runId,
                    test.order,
                ],
            });
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }

    private mapConfig(dbConfig: any): TestRunConfig {
        return {
            ...dbConfig.config,
            updated: dbConfig.updated.getTime(),
            status: dbConfig.status,
        };
    }
}
