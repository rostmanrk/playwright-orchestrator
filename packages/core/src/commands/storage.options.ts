import { Command, Option } from '@commander-js/extra-typings';
import { loadPluginModule } from '../plugin';

const STORAGES = ['file', 'dynamo-db', 'pg'] as const;

export type StorageType = (typeof STORAGES)[number];

export function fillStorageOptions(command: Command<any>) {
    command
        .addOption(new Option('--storage <string>', 'Storage type').choices(STORAGES))
        .on('option:storage', async function (this: Command, storage) {
            const { createOptions } = loadPluginModule(storage);
            createOptions(command);
        });
}
