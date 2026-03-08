import { test, afterAll, beforeAll } from 'vitest';
import { exec } from '../../e2e/test-utils.js';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';

const reportsFolder = './test-reports-folder-dynamo';
const config = 'tests-playwright.config.ts';
const storageOptions = `dynamo-db --endpoint-url http://localhost:${process.env.CI ? '8000' : '8002'}`;

beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID = 'local';
    process.env.AWS_SECRET_ACCESS_KEY = 'local';
    process.env.AWS_REGION = 'local';
    if (process.env.CI) return;
    await exec('npm run dynamo-local -- up test --wait');
});

afterAll(async () => {
    if (process.env.CI) return;
    await exec('npm run dynamo-local -- down test');
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test dynamo-db plugin', async () => {
    await testStorage(storageOptions, config, reportsFolder);
}, 90000);
