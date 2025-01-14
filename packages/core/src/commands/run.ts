import { program } from './program';
import { initializeAdapter } from '../plugin';
import { fillStorageOptions } from './storage.options';
import { TestRunner } from '../test-runner';

const command = program
    .command('run')
    .description('Start test run shard')
    .argument('<run-id>', 'Run id generated by create command')
    .option(
        '-o, --output <string>',
        'Output folder for blob reports. Existing content is deleted before writing the new report.',
        'blob-reports',
    )
    .action(async (runId, options) => {
        try {
            const adapter = await initializeAdapter(options);
            const runner = new TestRunner(runId, options.output, adapter);
            await runner.runTests();
            console.log('Run completed');
        } catch (error: any) {
            program.error(error.message);
        }
    });

fillStorageOptions(command);