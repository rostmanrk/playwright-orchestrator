import { loadPlugins } from '../helpers/plugin.js';
import { handle } from './command-hoc.js';
import { program } from './program.js';
import type { Initializer } from '../adapters/initializer.js';
import { SYMBOLS } from '../symbols.js';

export default async () => {
    const command = program.command('init').description('Run initialize script for selected storage type.');

    for await (const { register, subCommand } of loadPlugins(command)) {
        subCommand.action(
            handle(async (container, options) => {
                await register(container, options);
                const initializer = container.get<Initializer>(SYMBOLS.Initializer);
                await initializer.initialize();
                console.log('Storage initialized');
            }),
        );
    }
};
