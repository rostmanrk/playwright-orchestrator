import { Command } from '@commander-js/extra-typings';
import { Adapter } from '../types/adapters';
import { STORAGES } from '../plugins-list';

export type StorageType = (typeof STORAGES)[number];

export function loadPluginModule(storage: string):
    | {
          factory: (options: any) => Promise<Adapter>;
          createOptions: (command: Command) => void;
          description?: string;
      }
    | undefined {
    try {
        return require(`@playwright-orchestrator/${storage}`);
    } catch (error) {
        return;
    }
}

export function* loadPlugins(command: Command<any>) {
    for (const storage of STORAGES) {
        const plugin = loadPluginModule(storage);
        if (plugin) {
            const subCommand = command.command(storage);
            if (plugin.description) {
                subCommand.description(plugin.description);
            }
            plugin.createOptions(subCommand);
            yield { subCommand, factory: plugin.factory };
        }
    }
}
