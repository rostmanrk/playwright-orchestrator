import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { MySQLAdapter } from './mysql-adapter';
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
    return new MySQLAdapter(args);
}

export function createOptions(command: Command) {
    command
        .addOption(
            new Option('--table-name-prefix <string>', 'Tables name prefix')
                .default('playwright_orchestrator')
                .env('TABLE_NAME_PREFIX'),
        )
        .addOption(
            new Option('--connection-string <string>', 'Connection string')
                .makeOptionMandatory()
                .env('CONNECTION_STRING'),
        )
        .addOption(new Option('--ssl-profile <string>', 'SSL profile overrides other SSL options.').env('SSL_PROFILE'))
        .addOption(new Option('--ssl-ca <string>', 'SSL CA file').env('SSL_CA'))
        .addOption(new Option('--ssl-cert <string>', 'SSL certificate file').env('SSL_CERT'))
        .addOption(new Option('--ssl-key <string>', 'SSL key file').env('SSL_KEY'))
        .addOption(new Option('--ssl-passphrase <string>', 'SSL passphrase').env('SSL_PASSPHRASE'))
        .addOption(new Option('--ssl-reject-unauthorized', 'SSL reject unauthorized').env('SSL_REJECT_UNAUTHORIZED'))
        .addOption(
            new Option('--ssl-verify-server-certificate', 'SSL verify server certificate').env(
                'SSL_VERIFY_SERVER_CERTIFICATE',
            ),
        );
}

export const description = 'MySQL storage adapter';
