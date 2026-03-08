import { Command, Option } from '@commander-js/extra-typings';
import { Container } from 'inversify';
import { SYMBOLS } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { DynamoDbAdapter } from './dynamo-db-adapter.js';
import { DynamoDbShardHandler } from './dynamo-db-shard-handler.js';
import { DynamoDbInitializer } from './dynamo-db-initializer.js';
import { DynamoDbTestRunCreator } from './dynamo-db-test-run-creator.js';
import { DynamoDbConnection } from './dynamo-db-connection.js';
import { DYNAMO_CONFIG, DYNAMO_CONNECTION } from './symbols.js';

export function register(container: Container, options: CreateArgs): void {
    container.bind(DYNAMO_CONFIG).toConstantValue(options);
    container.bind(DYNAMO_CONNECTION).to(DynamoDbConnection).inSingletonScope();
    container.bind(SYMBOLS.Adapter).to(DynamoDbAdapter).inSingletonScope();
    container.bind(SYMBOLS.ShardHandler).to(DynamoDbShardHandler).inSingletonScope();
    container.bind(SYMBOLS.Initializer).to(DynamoDbInitializer).inSingletonScope();
    container.bind(SYMBOLS.TestRunCreator).to(DynamoDbTestRunCreator).inSingletonScope();
}

export function createOptions(command: Command) {
    command
        .addOption(
            new Option('--table-name-prefix <string>', 'DynamoDB table(s) name prefix')
                .default('playwright-orchestrator')
                .env('TABLE_NAME_PREFIX'),
        )
        .addOption(new Option('--ttl <number>', 'TTL in days').default('30').env('TTL'))
        .addOption(new Option('--endpoint-url <string>', 'DynamoDB endpoint URL'));
}

export const description = 'Amazon DynamoDB storage adapter';
