import { Command, Option } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { FileAdapter } from './file-adapter';

export async function factory(args: CreateArgs) {
    return new FileAdapter(args);
}

export function createOptions(command: Command) {
    command.addOption(
        new Option('--directory <string>', 'Directory to store test run data').default('test-runs').env('DIRECTORY'),
    );
}

export const description = 'Local file storage adapter';
