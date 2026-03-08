import { test, afterAll, beforeAll } from 'vitest';
import { exec } from '../../e2e/test-utils.js';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';

const reportsFolder = './test-reports-folder-mysql';
const config = 'tests-playwright.config.ts';
const storageOptions = `mysql --connection-string mysql://root:password@localhost:3307/test`;

beforeAll(async () => {
    if (process.env.CI) return;
    await exec('npm run mysql-local -- up test --wait');
}, 20000);

afterAll(async () => {
    if (process.env.CI) return;
    await exec('npm run mysql-local -- down test');
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test mysql plugin', async () => {
    await testStorage(storageOptions, config, reportsFolder);
}, 90000);
