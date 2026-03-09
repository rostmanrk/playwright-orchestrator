import { Command, Option } from '@commander-js/extra-typings';
import { Container } from 'inversify';
import { SYMBOLS } from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { FileAdapter } from './file-adapter.js';
import { FileShardHandler } from './file-shard-handler.js';
import { FileInitializer } from './file-initializer.js';
import { FileTestRunCreator } from './file-test-run-creator.js';
import { FILE_CONFIG } from './symbols.js';

export function register(container: Container, options: CreateArgs): void {
    container.bind(FILE_CONFIG).toConstantValue(options);
    container.bind(SYMBOLS.Adapter).to(FileAdapter).inSingletonScope();
    container.bind(SYMBOLS.ShardHandler).to(FileShardHandler).inSingletonScope();
    container.bind(SYMBOLS.Initializer).to(FileInitializer).inSingletonScope();
    container.bind(SYMBOLS.TestRunCreator).to(FileTestRunCreator).inSingletonScope();
}

export function createOptions(command: Command) {
    command.addOption(
        new Option('--directory <string>', 'Directory to store test run data').default('test-runs').env('DIRECTORY'),
    );
}

export const description = 'Local file storage adapter';
