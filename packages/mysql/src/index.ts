import { Command, Option } from '@commander-js/extra-typings';
import { Container } from 'inversify';
import { SYMBOLS } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MySQLAdapter } from './mysql-adapter.js';
import { MySQLShardHandler } from './mysql-shard-handler.js';
import { MySQLInitializer } from './mysql-initializer.js';
import { MySQLTestRunCreator } from './mysql-test-run-creator.js';
import { MySQLPool } from './mysql-pool.js';
import { readFile } from 'node:fs/promises';
import { MYSQL_CONFIG, MYSQL_POOL } from './symbols.js';

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
    container.bind(MYSQL_CONFIG).toConstantValue(options);
    container.bind(MYSQL_POOL).to(MySQLPool).inSingletonScope();
    container.bind(SYMBOLS.Adapter).to(MySQLAdapter).inSingletonScope();
    container.bind(SYMBOLS.ShardHandler).to(MySQLShardHandler).inSingletonScope();
    container.bind(SYMBOLS.Initializer).to(MySQLInitializer).inSingletonScope();
    container.bind(SYMBOLS.TestRunCreator).to(MySQLTestRunCreator).inSingletonScope();
}

export function createOptions(command: Command) {
    command
        .addOption(
            new Option('--table-name-prefix <string>', 'Tables name prefix')
                .default('playwright_orchestrator')
                .env('TABLE_NAME_PREFIX'),
        )
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        )
        .addOption(new Option('--ssl-profile <string>', 'SSL profile overrides other SSL options.').env('SSL_PROFILE'))
        .addOption(new Option('--ssl-ca <string>', 'SSL CA').env('SSL_CA'))
        .addOption(new Option('--ssl-cert <string>', 'SSL certificate').env('SSL_CERT'))
        .addOption(new Option('--ssl-key <string>', 'SSL key').env('SSL_KEY'))
        .addOption(new Option('--ssl-passphrase <string>', 'SSL passphrase').env('SSL_PASSPHRASE'))
        .addOption(new Option('--ssl-reject-unauthorized', 'SSL reject unauthorized').env('SSL_REJECT_UNAUTHORIZED'))
        .addOption(
            new Option('--ssl-verify-server-certificate', 'SSL verify server certificate').env(
                'SSL_VERIFY_SERVER_CERTIFICATE',
            ),
        );
}

export const description = 'MySQL storage adapter';
