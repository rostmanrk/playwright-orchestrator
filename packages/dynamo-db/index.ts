import { Command } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { DynamoDbAdapter } from './dynamo-db-adapter';

export { DynamoDbAdapter };

export function factory(args: CreateArgs) {
    return new DynamoDbAdapter(args);
}

export function createOptions(command: Command) {
    command
        .option('--table-name-prefix <string>', 'DynamoDB table(s) name prefix', 'playwright-orchestrator')
        .option('--ttl <number>', 'TTL in days', '30')
        .option('--endpoint-url <string>', 'DynamoDB endpoint URL');
}
