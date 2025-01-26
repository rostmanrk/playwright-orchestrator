import { loadPlugins } from '../helpers/plugin.js';
import { withErrorHandling } from './error-handler.js';
import { program } from './program.js';

export default async () => {
    const command = program.command('init').description('Run initialize script for selected storage type.');

    for await (const { factory, subCommand } of loadPlugins(command)) {
        subCommand.action(
            withErrorHandling(async (options) => {
                const adapter = await factory(options);
                await adapter.initialize();
                await adapter.dispose();
                console.log('Storage initialized');
            }),
        );
    }
};
