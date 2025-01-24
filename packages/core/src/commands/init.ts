import { loadPlugins } from '../helpers/plugin';
import { withErrorHandling } from './error-handler';
import { program } from './program';

const command = program.command('init').description('Run initialize script for selected storage type.');

for (const { factory, subCommand } of loadPlugins(command)) {
    subCommand.action(
        withErrorHandling(async (options) => {
            const adapter = await factory(options);
            await adapter.initialize();
            await adapter.dispose();
            console.log('Storage initialized');
        }),
    );
}
