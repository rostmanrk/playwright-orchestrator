import { injectable, inject } from 'inversify';
import type { Initializer } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MySQLPool } from './mysql-pool.js';
import { MYSQL_CONFIG, MYSQL_POOL } from './symbols.js';

@injectable()
export class MySQLInitializer implements Initializer {
    constructor(
        @inject(MYSQL_CONFIG) private readonly config: CreateArgs,
        @inject(MYSQL_POOL) private readonly mysqlPool: MySQLPool,
    ) {}

    async initialize(): Promise<void> {
        const { tableNamePrefix } = this.config;
        const configTable = `${tableNamePrefix}_test_runs`;
        const testsTable = `${tableNamePrefix}_tests`;
        const testInfoTable = `${tableNamePrefix}_tests_info`;
        const testInfoHistoryTable = `${tableNamePrefix}_tests_info_history`;
        await this.mysqlPool.pool.query({
            sql: `CREATE TABLE IF NOT EXISTS ?? (
                id binary(16) PRIMARY KEY,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                config JSON NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ?? (
                run_id binary(16) NOT NULL,
                order_num INT NOT NULL,
                status INT NOT NULL DEFAULT 0,
                test_id TEXT NOT NULL,
                file TEXT NOT NULL,
                line INT NOT NULL,
                pos INT NOT NULL,
                projects JSON NOT NULL,
                timeout INT NOT NULL,
                ema FLOAT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                report JSON,
                children JSON,
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ??(id),
                INDEX idx_status (status)
            );
            CREATE TABLE IF NOT EXISTS ?? (
                id INT PRIMARY KEY AUTO_INCREMENT,
                name TEXT NOT NULL,
                ema FLOAT NOT NULL,
                created TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE INDEX idx_name (name(255))
            );
            CREATE TABLE IF NOT EXISTS ?? (
                id INT PRIMARY KEY AUTO_INCREMENT,
                duration FLOAT NOT NULL,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                test_info_id INT NOT NULL,
                FOREIGN KEY (test_info_id) REFERENCES ??(id),
                INDEX idx_test_info_id (test_info_id)
            );
            `,
            values: [configTable, testsTable, configTable, testInfoTable, testInfoHistoryTable, testInfoTable],
        });

        await this.addColumnIfMissing(testsTable, 'children', 'JSON');
        await this.addColumnIfMissing(testsTable, 'ema', 'FLOAT', false, '0');
        await this.addColumnIfMissing(testsTable, 'test_id', 'TEXT', false, "''");
        await this.migrateProjectsToJson(testsTable);
    }

    private async migrateProjectsToJson(tableName: string): Promise<void> {
        const hasProjectsColumn = await this.columnExists(tableName, 'projects');
        if (hasProjectsColumn) return;

        await this.mysqlPool.pool.query({
            sql: `ALTER TABLE ?? ADD COLUMN projects JSON NULL;`,
            values: [tableName],
        });

        await this.mysqlPool.pool.query({
            sql: `UPDATE ?? SET projects = JSON_ARRAY(project)`,
            values: [tableName],
        });

        await this.mysqlPool.pool.query({
            sql: `ALTER TABLE ?? DROP COLUMN project;`,
            values: [tableName],
        });

        await this.mysqlPool.pool.query({
            sql: `ALTER TABLE ?? MODIFY COLUMN projects JSON NOT NULL;`,
            values: [tableName],
        });
    }

    private async columnExists(tableName: string, columnName: string): Promise<boolean> {
        const [rows] = await this.mysqlPool.pool.query({
            sql: `
SELECT 1
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = ?
    AND COLUMN_NAME = ?
LIMIT 1
`,
            values: [tableName, columnName],
        });
        return Array.isArray(rows) && rows.length > 0;
    }

    private async addColumnIfMissing(
        tableName: string,
        columnName: string,
        columnType: string,
        nullable: boolean = true,
        defaultValue?: string,
    ): Promise<void> {
        const exists = await this.columnExists(tableName, columnName);
        if (!exists) {
            await this.mysqlPool.pool.query({
                sql: `ALTER TABLE ?? ADD COLUMN ${columnName} ${columnType} NULL;`,
                values: [tableName],
            });
            if (defaultValue !== undefined) {
                await this.mysqlPool.pool.query({
                    sql: `UPDATE ?? SET ${columnName} = ${defaultValue} WHERE ${columnName} IS NULL;`,
                    values: [tableName],
                });
            }
            if (!nullable) {
                await this.mysqlPool.pool.query({
                    sql: `ALTER TABLE ?? MODIFY COLUMN ${columnName} ${columnType} NOT NULL;`,
                    values: [tableName],
                });
            }
        }
    }
}
