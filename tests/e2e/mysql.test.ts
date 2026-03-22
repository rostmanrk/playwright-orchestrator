import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';

const reportsFolder = './test-reports-folder-mysql';
const storageOptions = ['mysql', '--connection-string', 'mysql://root:password@localhost:3307/test'];

beforeAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['mysql-local', 'up', 'test', '--wait']);
}, 20000);

afterAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['mysql-local', 'down', 'test']);
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
