import * as uuid from 'uuid';
import { program } from './program.js';
import { loadPlugins } from '../helpers/plugin.js';
import { handle } from './command-hoc.js';
import { Option } from '@commander-js/extra-typings';
import type { TestRunCreator } from '../adapters/test-run-creator.js';
import { SYMBOLS } from '../symbols.js';
import { pick } from '../helpers/pick.js';
import { BatchMode, Grouping } from '../types/adapters.js';
import { PlaywrightRunInfoLoader } from '../adapters/playwright-run-info-loader.js';

export default async () => {
    const command = program
        .command('create')
        .description("Prepare new run configuration and fill storage. Supports all playwright's CLI options");

    for await (const { register, subCommand } of loadPlugins(command)) {
        subCommand
            .option('--history-window <number>', 'History window size', '10')
            .addOption(
                new Option('--batch-mode <mode>', 'Batch grouping mode')
                    .choices([BatchMode.Off, BatchMode.Time, BatchMode.Count] as const)
                    .default(BatchMode.Off),
            )
            .addOption(
                new Option(
                    '--batch-target <number>',
                    'Batch target value (seconds for time mode, count for count mode)',
                ),
            )
            .addOption(
                new Option('--grouping <grouping>', 'Test grouping strategy')
                    .choices([Grouping.Test, Grouping.Project] as const)
                    .default(Grouping.Test),
            )
            .allowUnknownOption()
            .allowExcessArguments()
            .action(
                handle(async (container, options) => {
                    if (options.batchMode !== BatchMode.Off && options.batchTarget === undefined) {
                        program.error(`--batch-target is required when --batch-mode is '${options.batchMode}'`, {
                            exitCode: 1,
                        });
                    }
                    const runId = uuid.v7();
                    const args = subCommand.args.slice(subCommand.registeredArguments.length);
                    await register(container, options);
                    container.bind(SYMBOLS.RunInfoLoader).to(PlaywrightRunInfoLoader).inSingletonScope();
                    const creator = container.get<TestRunCreator>(SYMBOLS.TestRunCreator);
                    const parsedOptions = {
                        ...pick(options, 'batchMode', 'grouping'),
                        historyWindow: +options.historyWindow,
                        batchTarget: options.batchTarget !== undefined ? +options.batchTarget : undefined,
                    };

                    await creator.create({
                        runId,
                        args,
                        options: parsedOptions,
                    });
                    console.log(runId);
                }),
            );
    }
};
