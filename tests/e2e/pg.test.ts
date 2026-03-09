import { test, afterAll, beforeAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';

const reportsFolder = './test-reports-folder-pg';
const config = 'tests-playwright.config.ts';
const storageOptions = ['pg', '--connection-string', 'postgres://postgres:password@localhost:5433/postgres'];

beforeAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('npm', ['run', 'pg-local', '--', 'up', 'test', '--wait']);
});

afterAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('npm', ['run', 'pg-local', '--', 'down', 'test']);
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test pg plugin', async () => {
    await testStorage(storageOptions, config, reportsFolder);
}, 90000);
