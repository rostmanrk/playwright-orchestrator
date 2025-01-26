import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args.js';
import { PostgreSQLAdapter } from './postgresql-adapter.js';
import { readFile } from 'node:fs/promises';

export async function factory(args: CreateArgs) {
    if (args.sslCa) {
        args.sslCa = await readFile(args.sslCa);
    }
    if (args.sslCert) {
        args.sslCert = await readFile(args.sslCert);
    }
    if (args.sslKey) {
        args.sslKey = await readFile(args.sslKey);
    }
    return new PostgreSQLAdapter(args);
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
