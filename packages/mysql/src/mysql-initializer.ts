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
                file TEXT NOT NULL,
                line INT NOT NULL,
                pos INT NOT NULL,
                project TEXT NOT NULL,
                timeout INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                report JSON,
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
            values: [
                configTable,
                testsTable,
                configTable,
                testInfoTable,
                testInfoHistoryTable,
                testInfoTable,
            ],
        });
    }
}
