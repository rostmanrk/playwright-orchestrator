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
                project TEXT NOT NULL,
                timeout INT NOT NULL,
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
        await this.addColumnIfMissing(testsTable, 'test_id', 'TEXT', false, "''", true);
    }

    async addColumnIfMissing(
        tableName: string,
        columnName: string,
        columnType: string, // e.g. "INT NOT NULL DEFAULT 0"
        nullable: boolean = true,
        defaultValue?: string,
        dropDefault: boolean = false,
    ): Promise<void> {
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

        const exists = Array.isArray(rows) && rows.length > 0;
        if (!exists) {
            // TEXT, BLOB, JSON, and GEOMETRY columns cannot have a DEFAULT value in MySQL.
            // For those types, add as nullable, backfill existing rows, then set NOT NULL.
            const isNoDefaultType = /^(TEXT|BLOB|JSON|GEOMETRY)/i.test(columnType.trim());
            if (isNoDefaultType && !nullable && dropDefault && defaultValue) {
                await this.mysqlPool.pool.query({
                    sql: `ALTER TABLE ?? ADD COLUMN ${columnName} ${columnType} NULL;`,
                    values: [tableName],
                });
                await this.mysqlPool.pool.query({
                    sql: `UPDATE ?? SET ${columnName} = ${defaultValue} WHERE ${columnName} IS NULL;`,
                    values: [tableName],
                });
                await this.mysqlPool.pool.query({
                    sql: `ALTER TABLE ?? MODIFY COLUMN ${columnName} ${columnType} NOT NULL;`,
                    values: [tableName],
                });
            } else {
                await this.mysqlPool.pool.query({
                    // Use escaped identifier for table name (??), column definition as trusted static string.
                    sql: `
ALTER TABLE ?? ADD COLUMN ${columnName} ${columnType}${nullable ? '' : ' NOT NULL'}${defaultValue ? ` DEFAULT ${defaultValue}` : ''};
${dropDefault ? `ALTER TABLE ?? ALTER COLUMN ${columnName} DROP DEFAULT;` : ''}
`,
                    values: [tableName, ...(dropDefault ? [tableName] : [])],
                });
            }
        }
    }
}
