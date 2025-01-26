import { Command } from '@commander-js/extra-typings';
import { Adapter } from '../types/adapters.js';
import { STORAGES } from '../plugins-list.js';

export type StorageType = (typeof STORAGES)[number];

export async function loadPluginModule(storage: string): Promise<
    | {
          factory: (options: any) => Promise<Adapter>;
          createOptions: (command: Command) => void;
          description?: string;
      }
    | undefined
> {
    try {
        const a = await import(`@playwright-orchestrator/${storage}`);
        return a;
    } catch (error) {
        return;
    }
}

export async function* loadPlugins(command: Command<any>) {
    for (const storage of STORAGES) {
        const plugin = await loadPluginModule(storage);
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
