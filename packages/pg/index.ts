import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { PostgreSQLAdapter } from './postgresql-adapter';
import { readFile } from 'node:fs/promises';

export async function factory(args: CreateArgs) {
    const { sslCa, sslCert, sslKey } = args;
    if (sslCa) {
        args.sslCa = await readFile(sslCa);
    }
    if (sslCert && sslKey) {
        args.sslCert = await readFile(sslCert);
        args.sslKey = await readFile(sslKey);
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
        .addOption(new Option('--ssl-ca <string>', 'SSL CA file').env('SSL_CA'))
        .addOption(new Option('--ssl-cert <string>', 'SSL certificate file').env('SSL_CERT'))
        .addOption(new Option('--ssl-key <string>', 'SSL key file').env('SSL_KEY'))
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        );
}

export const description = 'PostgreSQL storage adapter';
