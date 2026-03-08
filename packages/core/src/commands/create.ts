import * as uuid from 'uuid';
import { program } from './program.js';
import { loadPlugins } from '../helpers/plugin.js';
import { withErrorHandling } from './error-handler.js';
import chalk from 'chalk';
import { createContainer, SYMBOLS } from '../container.js';
import type { RunInfoLoader } from '../adapters/run-info-loader.js';
import type { TestRunCreator } from '../adapters/test-run-creator.js';

export default async () => {
    const command = program
        .command('create')
        .description("Prepare new run configuration and fill storage. Supports all playwright's CLI options");

    for await (const { register, subCommand } of loadPlugins(command)) {
        subCommand
            .option('--history-window <number>', 'History window size', '10')
            .allowUnknownOption()
            .allowExcessArguments()
            .action(
                withErrorHandling(async (options) => {
                    const runId = uuid.v7();
                    const args = subCommand.args.slice(subCommand.registeredArguments.length);
                    const container = createContainer();
                    const runInfo = await container.get<RunInfoLoader>(SYMBOLS.RunInfoLoader).load(args);
                    await register(container, options);
                    const creator = container.get<TestRunCreator>(SYMBOLS.TestRunCreator);
                    try {
                        await creator.create({ runId, testRun: runInfo, args, historyWindow: +options.historyWindow });
                        console.log(runId);
                    } finally {
                        await container.unbindAllAsync();
                    }
                }),
            );
    }
};
