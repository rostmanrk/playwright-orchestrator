import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';

const reportsFolder = './test-reports-folder-dynamo';
const config = 'tests-playwright.config.ts';
const storageOptions = ['dynamo-db', '--endpoint-url', `http://localhost:${process.env.CI ? '8000' : '8002'}`];

beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID = 'local';
    process.env.AWS_SECRET_ACCESS_KEY = 'local';
    process.env.AWS_REGION = 'local';
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['dynamo-local', 'up', 'test', '--wait']);
});

afterAll(async () => {
    if (process.env.CI) return;
    await spawnAsync('pnpm', ['dynamo-local', 'down', 'test']);
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('DynamoDb plugin', () => {
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
