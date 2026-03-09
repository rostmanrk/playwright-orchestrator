import { test, afterAll } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';

const filesFolder = 'test-runs-folder';
const reportsFolder = './test-reports-folder';
const config = 'tests-playwright.config.ts';
const storageOptions = ['file', '--directory', filesFolder];

afterAll(async () => {
    if (process.env.CI) return;
    await rm(filesFolder, { recursive: true, force: true });
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test file plugin', async () => {
    // init command
    await testStorage(storageOptions, config, reportsFolder);
}, 90000);
