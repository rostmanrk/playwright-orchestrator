import { injectable, inject } from 'inversify';
import { BaseTestRunCreator, RunStatus, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestSortItem } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MySQLPool } from './mysql-pool.js';
import { Pool, RowDataPacket, ResultSetHeader } from 'mysql2/promise';
import { MYSQL_CONFIG, MYSQL_POOL } from './symbols.js';

interface TestInfo extends RowDataPacket {
    id: number;
    ema: number;
    created: Date;
    name: string;
    fails: number;
}

@injectable()
export class MySQLTestRunCreator extends BaseTestRunCreator {
    private readonly configTable: string;
    private readonly testsTable: string;
    private readonly testInfoTable: string;
    private readonly testInfoHistoryTable: string;
    private readonly pool: Pool;

    constructor(@inject(MYSQL_CONFIG) { tableNamePrefix }: CreateArgs, @inject(MYSQL_POOL) mysqlPool: MySQLPool) {
        super();
        this.pool = mysqlPool.pool;
        this.configTable = `${tableNamePrefix}_test_runs`;
        this.testsTable = `${tableNamePrefix}_tests`;
        this.testInfoTable = `${tableNamePrefix}_tests_info`;
        this.testInfoHistoryTable = `${tableNamePrefix}_tests_info_history`;
    }

    async loadTestInfos(tests: TestItem[]): Promise<Map<string, TestSortItem>> {
        if (!tests.length) {
            return new Map<string, TestSortItem>();
        }
        const [results] = await this.pool.query<TestInfo[][]>({
            sql: `CREATE TEMPORARY TABLE temp_values (
                name TEXT NOT NULL,
                ema FLOAT DEFAULT 0,
                created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
            );

            INSERT INTO temp_values (name)
            VALUES ${tests.map(() => '(?)').join(', ')};

            INSERT INTO ?? (name, ema, created)
            SELECT * FROM temp_values t WHERE NOT EXISTS (
                SELECT 1 FROM ??
                WHERE name = t.name
            );

            SELECT
                id,
                name,
                ema,
                created,
                (
                    SELECT COUNT(*) FROM ??
                    WHERE status = ? AND test_info_id = info.id
                ) AS fails
            FROM ?? info
            WHERE name IN (SELECT name FROM temp_values);

            DROP TEMPORARY TABLE IF EXISTS temp_values;`,
            values: [
                ...tests.map((t) => t.testId),
                this.testInfoTable,
                this.testInfoTable,
                this.testInfoHistoryTable,
                TestStatus.Failed,
                this.testInfoTable,
            ],
        });

        const testInfoMap = new Map<string, TestSortItem>();
        for (const test of results[3]) {
            testInfoMap.set(test.name, { ema: test.ema, fails: test.fails });
        }
        return testInfoMap;
    }

    async saveRunData(runId: string, config: object, tests: TestItem[]): Promise<void> {
        const testValues = tests.map(({ position, order, file, project, timeout, children, testId }) => {
            const [line, character] = position.split(':');
            return [
                runId,
                order,
                file,
                +line,
                +character,
                project,
                timeout,
                children != null ? JSON.stringify(children) : null,
                testId,
            ];
        });

        const statements: string[] = [`INSERT INTO ?? (id, status, config) VALUES (UUID_TO_BIN(?), ?, ?)`];
        const values: (string | number | object | null | undefined)[] = [
            this.configTable,
            runId,
            RunStatus.Created,
            JSON.stringify(config),
        ];
        if (testValues.length) {
            statements.push(
                `INSERT INTO ?? (run_id, order_num, file, line, pos, project, timeout, children, test_id) VALUES ${testValues
                    .map(() => '(UUID_TO_BIN(?), ?, ?, ?, ?, ?, ?, ?, ?)')
                    .join(', ')}`,
            );
            values.push(this.testsTable, ...testValues.flatMap((v) => v));
        }
        await this.pool.query<ResultSetHeader>({
            sql: `
            ${statements.join(';\n')};`,
            values,
        });
    }
}
