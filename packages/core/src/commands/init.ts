import { program } from './program';
import { initializeAdapter } from '../plugin';
import { fillStorageOptions } from './storage.options';

const command = program
    .command('init')
    .description('Run initialize script for selected storage type.')
    .action(async (options) => {
        try {
            const adapter = await initializeAdapter(options);
            await adapter.initialize();
            console.log('Storage initialized');
        } catch (error: any) {
            program.error(error.message);
        }
    });

fillStorageOptions(command);
