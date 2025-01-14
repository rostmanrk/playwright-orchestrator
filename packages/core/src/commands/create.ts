import * as uuid from 'uuid';
import { program } from './program';
import { initializeAdapter } from '../plugin';
import { fillStorageOptions } from './storage.options';
import { loadReporterInfo } from '../reporter-tools';

const command = program
    .command('create')
    .description("Prepare new run configuration and fill storage. Supports all playwright's CLI options")
    .allowUnknownOption()
    .allowExcessArguments()
    .action(async (options, command) => {
        try {
            const runId = uuid.v7();
            const args = command.args.slice(command.registeredArguments.length);
            const testsInfo = await loadReporterInfo(args);
            const adapter = await initializeAdapter(options);
            await adapter.saveTestRun(runId, testsInfo, args);
            console.log(runId);
        } catch (error: any) {
            program.error(error.message);
        }
    });

fillStorageOptions(command);
