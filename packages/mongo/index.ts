import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { MongoDbAdapter } from './mongo-db-adapter';

export async function factory(args: CreateArgs) {
    return new MongoDbAdapter(args);
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
        .addOption(new Option('--db <string>', 'Database name').env('DB').makeOptionMandatory())
        .addOption(new Option('--tls', 'Enable TLS').env('TLS'))
        .addOption(new Option('--debug', 'Add extra fields for some collections').env('DEBUG'));
}

export const description = 'MongoDB storage adapter';
