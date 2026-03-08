import { test, expect, afterAll, beforeAll } from 'vitest';
import { exec } from '../../e2e/test-utils.js';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';

const reportsFolder = './test-reports-folder-redis';
const config = 'tests-playwright.config.ts';
const storageOptions = `redis --connection-string redis://localhost:6380`;

beforeAll(async () => {
    if (process.env.CI) return;
    await exec('npm run redis-local -- up test --wait');
});

afterAll(async () => {
    if (process.env.CI) return;
    await exec('npm run redis-local -- down test');
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test redis plugin', async () => {
    await testStorage(storageOptions, config, reportsFolder);
}, 90000);
