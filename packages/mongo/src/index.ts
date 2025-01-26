import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args.js';
import { MongoDbAdapter } from './mongo-db-adapter.js';

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
