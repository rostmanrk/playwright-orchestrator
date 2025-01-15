import * as uuid from 'uuid';
import { program } from './program';
import { loadReporterInfo } from '../reporter-tools';
import { loadPlugins } from '../plugin';
import { withErrorHandling } from './error-handler';

const command = program
    .command('create')
    .description("Prepare new run configuration and fill storage. Supports all playwright's CLI options");

for (const { factory, subCommand } of loadPlugins(command)) {
    subCommand
        .allowUnknownOption()
        .allowExcessArguments()
        .action(
            withErrorHandling(async (options) => {
                const runId = uuid.v7();
                const args = command.args.slice(command.registeredArguments.length);
                const testsInfo = await loadReporterInfo(args);
                const adapter = factory(options);
                await adapter.saveTestRun(runId, testsInfo, args);
                console.log(runId);
            }),
        );
}
