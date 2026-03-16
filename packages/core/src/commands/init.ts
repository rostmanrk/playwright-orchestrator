import { loadPlugins } from '../helpers/plugin.js';
import { withErrorHandling } from './error-handler.js';
import { program } from './program.js';
import { createContainer } from '../container.js';
import type { Initializer } from '../adapters/initializer.js';
import { SYMBOLS } from '../symbols.js';

export default async () => {
    const command = program.command('init').description('Run initialize script for selected storage type.');

    for await (const { register, subCommand } of loadPlugins(command)) {
        subCommand.action(
            withErrorHandling(async (options) => {
                const container = createContainer();
                await register(container, options);
                const initializer = container.get<Initializer>(SYMBOLS.Initializer);
                try {
                    await initializer.initialize();
                    console.log('Storage initialized');
                } finally {
                    await container.unbindAllAsync();
                }
            }),
        );
    }
};
