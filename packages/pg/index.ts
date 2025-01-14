import { Command } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { PostgreSQLAdapter } from './postgresql-adapter';

export { PostgreSQLAdapter as PostreSQLAdapter };

export function factory(args: CreateArgs) {
    return new PostgreSQLAdapter(args);
}

export function createOptions(command: Command) {
    command
        .option('--table-name-prefix <string>', 'Tables name prefix', 'playwright_orchestrator')
        .requiredOption('--connection-string <string>', 'Connection string');
}

export const description = 'PostgreSQL storage adapter';
