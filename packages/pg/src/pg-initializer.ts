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
            ALTER TABLE ${configTable} ADD COLUMN IF NOT EXISTS shards JSONB;
            CREATE TABLE IF NOT EXISTS ${testsTable} (
                run_id UUID NOT NULL,
                order_num INT NOT NULL,
                status INT NOT NULL DEFAULT 0,
                test_id TEXT NOT NULL,
                file TEXT NOT NULL,
                line INT NOT NULL,
                character INT NOT NULL,
                projects JSONB NOT NULL,
                timeout INT NOT NULL,
                ema FLOAT NOT NULL,
                updated TIMESTAMP NOT NULL DEFAULT NOW(),
                report JSONB,
                children JSONB,
                PRIMARY KEY (run_id, order_num),
                FOREIGN KEY (run_id) REFERENCES ${configTable}(id)
            );
            ALTER TABLE ${testsTable} ADD COLUMN IF NOT EXISTS children JSONB;
            ALTER TABLE ${testsTable} ADD COLUMN IF NOT EXISTS ema FLOAT NOT NULL DEFAULT 0;
            ALTER TABLE ${testsTable} ALTER COLUMN ema DROP DEFAULT;
            ALTER TABLE ${testsTable} ADD COLUMN IF NOT EXISTS test_id TEXT NOT NULL DEFAULT '';
            ALTER TABLE ${testsTable} ALTER COLUMN test_id DROP DEFAULT;
            DO $$
            BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM information_schema.columns
                WHERE table_name = ${pg.escapeLiteral(`${tableNamePrefix}_tests`)} AND column_name = 'projects'
            ) THEN
                ALTER TABLE ${testsTable} ADD COLUMN projects JSONB NOT NULL DEFAULT '[]';
                UPDATE ${testsTable} SET projects = jsonb_build_array(project) WHERE project IS NOT NULL;
                ALTER TABLE ${testsTable} DROP COLUMN IF EXISTS project;
                ALTER TABLE ${testsTable} ALTER COLUMN projects DROP DEFAULT;
            END IF;
            END $$;
            UPDATE ${testsTable} SET projects = '[]' WHERE projects IS NULL;
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
