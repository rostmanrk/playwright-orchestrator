import { it, afterAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';

const filesFolder = 'test-runs-folder';
const reportsFolder = './test-reports-folder';
const config = 'tests-playwright.config.ts';
const storageOptions = ['file', '--directory', filesFolder];

afterAll(async () => {
    if (process.env.CI) return;
    await rm(filesFolder, { recursive: true, force: true });
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('File plugin', () => {
    it(
        'grouping by test',
        async () => {
            await testStorage(storageOptions, config, reportsFolder, Grouping.Test);
        },
        TEST_TIMEOUT,
    );

    it(
        'grouping by project',
        async () => {
            await testStorage(storageOptions, config, reportsFolder, Grouping.Project);
        },
        TEST_TIMEOUT,
    );
});
