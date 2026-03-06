import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args.js';
import { RedisAdapter } from './redis-adapter.js';

export async function factory(args: CreateArgs) {
    return new RedisAdapter(args);
}

export function createOptions(command: Command) {
    command
        .addOption(new Option('--name-prefix <string>', 'Records name prefix').default('pw').env('TABLE_NAME_PREFIX'))
        .addOption(new Option('--ttl <number>', 'Time to live in days').default(60).env('TTL'))
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        );
}

export const description = 'Redis storage adapter';
