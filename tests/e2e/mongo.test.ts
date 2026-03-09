import { test, afterAll, beforeAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';

const reportsFolder = './test-reports-folder-mongo';
const config = 'tests-playwright.config.ts';
const storageOptions = ['mongo', '--connection-string', 'mongodb://root:password@localhost:27018/', '--db', 'test'];

beforeAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('npm', ['run', 'mongo-local', '--', 'up', 'test', '--wait']);
});

afterAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('npm', ['run', 'mongo-local', '--', 'down', 'test']);
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test mongodb plugin', async () => {
    await testStorage(storageOptions, config, reportsFolder);
}, 90000);
