import { injectable, inject } from 'inversify';
import type { Initializer } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { PgPool } from './pg-pool.js';
import pg from 'pg';
import { PG_CONFIG, PG_POOL } from './symbols.js';

@injectable()
export class PgInitializer implements Initializer {
    constructor(
        @inject(PG_CONFIG) private readonly config: CreateArgs,
        @inject(PG_POOL) private readonly pgPool: PgPool,
    ) {}

    async initialize(): Promise<void> {
        const { tableNamePrefix } = this.config;
        const configTable = pg.escapeIdentifier(`${tableNamePrefix}_test_runs`);
        const testsTable = pg.escapeIdentifier(`${tableNamePrefix}_tests`);
        const testInfoTable = pg.escapeIdentifier(`${tableNamePrefix}_test_info`);
        const testInfoHistoryTable = pg.escapeIdentifier(`${tableNamePrefix}_test_info_history`);
        await this.pgPool.pool.query(
            `CREATE TABLE IF NOT EXISTS ${configTable} (
                id UUID PRIMARY KEY,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                config JSONB NOT NULL
            );
            CREATE TABLE IF NOT EXISTS ${testsTable} (
                run_id UUID NOT NULL,
                order_num INT NOT NULL,
                status INT NOT NULL DEFAULT 0,
                file TEXT NOT NULL,
                line INT NOT NULL,
                character INT NOT NULL,
                project TEXT NOT NULL,
                timeout INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                report JSONB,
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ${configTable}(id)
            );
            CREATE INDEX IF NOT EXISTS status_idx ON ${testsTable}(status);
            CREATE TABLE IF NOT EXISTS ${testInfoTable} (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                ema FLOAT NOT NULL DEFAULT 0,
                created TIMESTAMP NOT NULL DEFAULT NOW()
            );
            CREATE INDEX IF NOT EXISTS name_idx ON ${testInfoTable} USING HASH (name);
            CREATE TABLE IF NOT EXISTS ${testInfoHistoryTable} (
                id SERIAL PRIMARY KEY,
                duration FLOAT NOT NULL,
                status INT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                test_info_id INT NOT NULL,
                FOREIGN KEY (test_info_id) REFERENCES ${testInfoTable}(id)
            );
            CREATE INDEX IF NOT EXISTS test_info_id_idx ON ${testInfoHistoryTable}(test_info_id);`,
        );
    }
}
