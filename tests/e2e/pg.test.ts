import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';

const reportsFolder = './test-reports-folder-pg';
const storageOptions = ['pg', '--connection-string', 'postgres://postgres:password@localhost:5433/postgres'];

beforeAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['pg-local', 'up', 'test', '--wait']);
});

afterAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['pg-local', 'down', 'test']);
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('PostgreSQL plugin', () => {
    it(
        'test pg plugin',
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
