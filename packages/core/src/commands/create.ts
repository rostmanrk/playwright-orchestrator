import * as uuid from 'uuid';
import { program } from './program.js';
import { loadPlugins } from '../helpers/plugin.js';
import { withErrorHandling } from './error-handler.js';
import { Option } from '@commander-js/extra-typings';
import { createContainer } from '../container.js';
import type { RunInfoLoader } from '../adapters/run-info-loader.js';
import type { TestRunCreator } from '../adapters/test-run-creator.js';
import type { BatchOptions } from '../types/adapters.js';
import { SYMBOLS } from '../symbols.js';

export default async () => {
    const command = program
        .command('create')
        .description("Prepare new run configuration and fill storage. Supports all playwright's CLI options");

    for await (const { register, subCommand } of loadPlugins(command)) {
        subCommand
            .option('--history-window <number>', 'History window size', '10')
            .addOption(
                new Option('--batch-mode <mode>', 'Batch grouping mode')
                    .choices(['off', 'time', 'count'] as const)
                    .default('off'),
            )
            .addOption(
                new Option(
                    '--batch-target <number>',
                    'Batch target value (seconds for time mode, count for count mode)',
                ),
            )
            .addOption(
                new Option('--batch-grouping <grouping>', 'Batch grouping strategy')
                    .choices(['test', 'project'] as const)
                    .default('test'),
            )
            .allowUnknownOption()
            .allowExcessArguments()
            .action(
                withErrorHandling(async (options) => {
                    if (
                        (options.batchMode === 'time' || options.batchMode === 'count') &&
                        options.batchTarget === undefined
                    ) {
                        throw new Error(`--batch-target is required when --batch-mode is '${options.batchMode}'`);
                    }
                    if (options.batchMode !== 'off') {
                        throw new Error(`Batch mode '${options.batchMode}' is not implemented yet`);
                    }
                    const runId = uuid.v7();
                    const args = subCommand.args.slice(subCommand.registeredArguments.length);
                    const container = createContainer();
                    const runInfo = await container.get<RunInfoLoader>(SYMBOLS.RunInfoLoader).load(args);
                    await register(container, options);
                    const creator = container.get<TestRunCreator>(SYMBOLS.TestRunCreator);
                    const batchOptions: BatchOptions = {
                        batchMode: options.batchMode,
                        batchTarget: options.batchTarget !== undefined ? +options.batchTarget : undefined,
                        batchGrouping: options.batchGrouping,
                    };
                    try {
                        await creator.create({
                            runId,
                            testRun: runInfo,
                            args,
                            historyWindow: +options.historyWindow,
                            batchOptions,
                        });
                        console.log(runId);
                    } finally {
                        await container.unbindAllAsync();
                    }
                }),
            );
    }
};
