import { Command, Option } from '@commander-js/extra-typings';
import { Container } from 'inversify';
import { SYMBOLS } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { RedisAdapter } from './redis-adapter.js';
import { RedisShardHandler } from './redis-shard-handler.js';
import { RedisInitializer } from './redis-initializer.js';
import { RedisTestRunCreator } from './redis-test-run-creator.js';
import { RedisConnection } from './redis-connection.js';
import { REDIS_CONFIG, REDIS_CONNECTION } from './symbols.js';

export function register(container: Container, options: CreateArgs): void {
    container.bind(REDIS_CONFIG).toConstantValue(options);
    container.bind(REDIS_CONNECTION).to(RedisConnection).inSingletonScope();
    container.bind(SYMBOLS.Adapter).to(RedisAdapter).inSingletonScope();
    container.bind(SYMBOLS.ShardHandler).to(RedisShardHandler).inSingletonScope();
    container.bind(SYMBOLS.Initializer).to(RedisInitializer).inSingletonScope();
    container.bind(SYMBOLS.TestRunCreator).to(RedisTestRunCreator).inSingletonScope();
}

export function createOptions(command: Command) {
    command
        .addOption(new Option('--name-prefix <string>', 'Records name prefix').default('pw').env('TABLE_NAME_PREFIX'))
        .addOption(new Option('--ttl <number>', 'Time to live in days').default(30).env('TTL'))
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        );
}

export const description = 'Redis storage adapter';
