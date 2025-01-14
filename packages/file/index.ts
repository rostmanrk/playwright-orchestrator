import { Command } from '@commander-js/extra-typings';
import { CreateArgs } from './create-args';
import { FileAdapter } from './file-adapter';

export function factory(args: CreateArgs) {
    return new FileAdapter(args);
}

export function createOptions(command: Command) {
    command.option('--directory <string>', 'Directory to store test run data', 'test-runs');
}
