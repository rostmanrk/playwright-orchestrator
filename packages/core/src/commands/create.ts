import * as uuid from 'uuid';
import { program } from './program.js';
import { loadRunInfo } from '../helpers/reporter-tools.js';
import { loadPlugins } from '../helpers/plugin.js';
import { withErrorHandling } from './error-handler.js';
import chalk from 'chalk';

export default async () => {
    const command = program
        .command('create')
        .description("Prepare new run configuration and fill storage. Supports all playwright's CLI options");

    for await (const { factory, subCommand } of loadPlugins(command)) {
        subCommand
            .option('--history-window <number>', 'History window size', '10')
            .allowUnknownOption()
            .allowExcessArguments()
            .action(
                withErrorHandling(async (options) => {
                    const runId = uuid.v7();
                    const args = subCommand.args.slice(subCommand.registeredArguments.length);
                    const runInfo = await loadRunInfo(args);
                    const adapter = await factory(options);
                    await adapter.saveTestRun({ runId, testRun: runInfo, args, historyWindow: +options.historyWindow });
                    await adapter.dispose();
                    console.log(chalk.green(runId));
                }),
            );
    }
};
