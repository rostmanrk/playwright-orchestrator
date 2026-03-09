import { Command, Option } from '@commander-js/extra-typings';
import { Container } from 'inversify';
import { SYMBOLS } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MongoDbAdapter } from './mongo-db-adapter.js';
import { MongoShardHandler } from './mongo-shard-handler.js';
import { MongoInitializer } from './mongo-initializer.js';
import { MongoTestRunCreator } from './mongo-test-run-creator.js';
import { MongoConnection } from './mongo-connection.js';
import { MONGO_CONFIG, MONGO_CONNECTION } from './symbols.js';

export function register(container: Container, options: CreateArgs): void {
    container.bind(MONGO_CONFIG).toConstantValue(options);
    container.bind(MONGO_CONNECTION).to(MongoConnection).inSingletonScope();
    container.bind(SYMBOLS.Adapter).to(MongoDbAdapter).inSingletonScope();
    container.bind(SYMBOLS.ShardHandler).to(MongoShardHandler).inSingletonScope();
    container.bind(SYMBOLS.Initializer).to(MongoInitializer).inSingletonScope();
    container.bind(SYMBOLS.TestRunCreator).to(MongoTestRunCreator).inSingletonScope();
}

export function createOptions(command: Command) {
    command
        .addOption(
            new Option('--collection-name-prefix <string>', 'Collections name prefix')
                .default('playwright_orchestrator')
                .env('TABLE_NAME_PREFIX'),
        )
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        )
        .addOption(new Option('--db <string>', 'Database name').env('DB'))
        .addOption(new Option('--tls', 'Enable TLS').env('TLS'))
        .addOption(new Option('--tls-ca <string>', 'TLS CA').env('TLS_CA'))
        .addOption(new Option('--tls-key-password <string>', 'TLS key password').env('TLS_KEY_PASSWORD'))
        .addOption(new Option('--tls-key <string>', 'TLS key').env('TLS_KEY'))
        .addOption(new Option('--tls-passphrase <string>', 'TLS passphrase').env('TLS_PASSPHRASE'))
        .addOption(
            new Option('--tls-allow-invalid-certificates', 'Allow invalid certificates').env(
                'TLS_ALLOW_INVALID_CERTIFICATES',
            ),
        )
        .addOption(
            new Option('--tls-allow-invalid-hostnames', 'Allow invalid hostnames').env('TLS_ALLOW_INVALID_HOSTNAMES'),
        )
        .addOption(new Option('--tls-insecure', 'Insecure').env('TLS_INSECURE'))
        .addOption(new Option('--debug', 'Add extra fields for some collections').env('DEBUG'));
}

export const description = 'MongoDB storage adapter';
