import { Command } from '@commander-js/extra-typings';
import { Adapter } from './types/adapters';

export function initializeAdapter(storageOptions: any): Adapter {
    const { factory } = loadPluginModule(storageOptions.storage);
    return factory(storageOptions);
}

export function loadPluginModule(storage: string): {
    factory: (options: any) => Adapter;
    createOptions: (command: Command) => void;
} {
    let module = loadStoragePlugin(storage);
    if (module) return module;

    throw new Error(
        `Storage adapter '${storage}' is not installed. Please run 'npm i @playwright-orchestrator/${storage}'`,
    );
}

function loadStoragePlugin(storage: string) {
    try {
        return require(`@playwright-orchestrator/${storage}`);
    } catch (error) {
        return;
    }
}
