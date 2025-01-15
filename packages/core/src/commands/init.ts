import { loadPlugins } from '../plugin';
import { withErrorHandling } from './error-handler';
import { program } from './program';

const command = program.command('init').description('Run initialize script for selected storage type.');

for (const { factory, subCommand } of loadPlugins(command)) {
    subCommand.action(
        withErrorHandling(async (options) => {
            const adapter = factory(options);
            await adapter.initialize();
            console.log('Storage initialized');
        }),
    );
}
