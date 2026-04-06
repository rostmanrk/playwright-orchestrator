import { injectable, inject, injectFromBase } from 'inversify';
import { BaseTestRunCreator, RunStatus, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRun, TestSortItem } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { PgPool } from './pg-pool.js';
import pg from 'pg';
import { PG_CONFIG, PG_POOL } from './symbols.js';

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
export class PgTestRunCreator extends BaseTestRunCreator {
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

    async loadTestInfos(tests: TestItem[]): Promise<Map<string, TestSortItem>> {
        const results = await this.pool.query({
            text: `
            WITH test_names AS (
                SELECT UNNEST($1::TEXT[]) AS name
            ),
            existing_tests AS (
                SELECT id, name, ema, created FROM ${this.testInfoTable}
                WHERE name IN (SELECT name FROM test_names)
            ),
            inserted_tests AS (
                INSERT INTO ${this.testInfoTable} (name)
                SELECT name FROM test_names
                WHERE NOT EXISTS (
                    SELECT 1 FROM ${this.testInfoTable} WHERE name = test_names.name
                )
                RETURNING id, name, ema, created
            ),
            combined_tests AS (
                SELECT * FROM existing_tests
                UNION ALL
                SELECT * FROM inserted_tests
            )
            SELECT
                t.id,
                t.name,
                t.ema,
                t.created,
                COUNT(CASE WHEN h.status = ${TestStatus.Failed} THEN 1 END) as fails
            FROM combined_tests t
            LEFT JOIN ${this.testInfoHistoryTable} h ON h.test_info_id = t.id
            GROUP BY t.id, t.name, t.ema, t.created`,
            values: [tests.map((t) => t.testId)],
        });
        const testInfo = new Map<string, TestSortItem>();
        for (const { name, ema, fails } of results.rows) {
            testInfo.set(name, { ema, fails: +fails });
        }
        return testInfo;
    }

    async saveRunData(runId: string, run: TestRun, tests: TestItem[]): Promise<void> {
        const client = await this.pool.connect();
        try {
            await client.query('BEGIN');
            await client.query({
                text: `INSERT INTO ${this.configTable} (id, status, config, shards) VALUES ($1, $2, $3, '{}')`,
                values: [runId, RunStatus.Created, JSON.stringify(run.config)],
            });
            if (tests.length > 0) {
                const fields = [
                    'order_num',
                    'file',
                    'line',
                    'character',
                    'projects',
                    'timeout',
                    'ema',
                    'children',
                    'test_id',
                ];
                await client.query({
                    text: `INSERT INTO ${this.testsTable} (run_id, ${fields.join(', ')}) VALUES ${tests
                        .map((_, i) => {
                            const len = fields.length;
                            const values = fields.map((_, j) => `$${i * len + j + 2}`).join(', ');
                            return `($1, ${values})`;
                        })
                        .join(', ')}`,
                    values: [
                        runId,
                        ...tests.flatMap(({ position, order, file, projects, timeout, ema, children, testId }) => {
                            const [line, character] = position.split(':');
                            return [
                                order,
                                file,
                                line,
                                character,
                                JSON.stringify(projects),
                                timeout,
                                ema,
                                children != null ? JSON.stringify(children) : null,
                                testId,
                            ];
                        }),
                    ],
                });
            }
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK');
            throw e;
        } finally {
            client.release();
        }
    }
}
