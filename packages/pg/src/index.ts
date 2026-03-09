import { Command, Option } from '@commander-js/extra-typings';
import { Container } from 'inversify';
import { SYMBOLS } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { PostgreSQLAdapter } from './postgresql-adapter.js';
import { PgShardHandler } from './pg-shard-handler.js';
import { PgInitializer } from './pg-initializer.js';
import { PgTestRunCreator } from './pg-test-run-creator.js';
import { PgPool } from './pg-pool.js';
import { readFile } from 'node:fs/promises';
import { PG_CONFIG, PG_POOL } from './symbols.js';

export async function register(container: Container, options: CreateArgs): Promise<void> {
    if (options.sslCa) {
        options.sslCa = await readFile(options.sslCa as string);
    }
    if (options.sslCert) {
        options.sslCert = await readFile(options.sslCert as string);
    }
    if (options.sslKey) {
        options.sslKey = await readFile(options.sslKey as string);
    }
    container.bind(PG_CONFIG).toConstantValue(options);
    container.bind(PG_POOL).to(PgPool).inSingletonScope();
    container.bind(SYMBOLS.Adapter).to(PostgreSQLAdapter).inSingletonScope();
    container.bind(SYMBOLS.ShardHandler).to(PgShardHandler).inSingletonScope();
    container.bind(SYMBOLS.Initializer).to(PgInitializer).inSingletonScope();
    container.bind(SYMBOLS.TestRunCreator).to(PgTestRunCreator).inSingletonScope();
}

export function createOptions(command: Command) {
    command
        .addOption(
            new Option('--table-name-prefix <string>', 'Tables name prefix')
                .default('playwright_orchestrator')
                .env('TABLE_NAME_PREFIX'),
        )
        .addOption(new Option('--ssl-ca <string>', 'SSL CA').env('SSL_CA'))
        .addOption(new Option('--ssl-cert <string>', 'SSL certificate').env('SSL_CERT'))
        .addOption(new Option('--ssl-key <string>', 'SSL key').env('SSL_KEY'))
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        );
}

export const description = 'PostgreSQL storage adapter';
