import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args.js';
import { DynamoDbAdapter } from './dynamo-db-adapter.js';

export async function factory(args: CreateArgs) {
    return new DynamoDbAdapter(args);
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
