import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';
import { MySqlContainer, StartedMySqlContainer } from '@testcontainers/mysql';

const reportsFolder = './test-reports-folder-mysql';
let container: StartedMySqlContainer | undefined;
let storageOptions: string[];

beforeAll(async () => {
    const connectionString = process.env.MYSQL_CONNECTION_STRING;
    if (connectionString) {
        storageOptions = ['mysql', '--connection-string', connectionString];
    } else {
        container = await new MySqlContainer().start();
        storageOptions = ['mysql', '--connection-string', container.getConnectionUri()];
    }
}, 60000);

afterAll(async () => {
    await container?.stop();
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('MySQL plugin', () => {
    it(
        'grouping by test',
        async () => {
            await testStorage(storageOptions, reportsFolder, Grouping.Test);
        },
        TEST_TIMEOUT,
    );

    it(
        'grouping by project',
        async () => {
            await testStorage(storageOptions, reportsFolder, Grouping.Project);
        },
        TEST_TIMEOUT,
    );
});
