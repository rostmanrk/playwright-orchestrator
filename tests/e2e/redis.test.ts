import { test, afterAll, beforeAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import { TEST_TIMEOUT } from '../utils/constants.js';

const reportsFolder = './test-reports-folder-redis';
const config = 'tests-playwright.config.ts';
const storageOptions = [
    'redis',
    '--connection-string',
    process.env.CI ? 'redis://localhost:6379' : 'redis://localhost:6380',
];

beforeAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['redis-local', 'up', 'test', '--wait']);
});

afterAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['redis-local', 'down', 'test']);
    await rm(reportsFolder, { recursive: true, force: true });
});

test(
    'test redis plugin',
    async () => {
        await testStorage(storageOptions, config, reportsFolder);
    },
    TEST_TIMEOUT,
);
