import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { testAbandonedClaims } from '../utils/test-abandoned-claims.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';

const reportsFolder = './test-reports-folder-redis';
let container: StartedRedisContainer | undefined;
let storageOptions: string[];

beforeAll(async () => {
    const connectionString = process.env.REDIS_CONNECTION_STRING;
    if (connectionString) {
        storageOptions = ['redis', '--connection-string', connectionString];
    } else {
        container = await new RedisContainer('redis:7.2').start();
        storageOptions = ['redis', '--connection-string', container.getConnectionUrl()];
    }
}, 60000);

afterAll(async () => {
    await container?.stop();
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('Redis plugin', () => {
    it(
        'test redis plugin',
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
    it(
        're-runs tests claimed by a killed shard',
        async () => {
            await testAbandonedClaims(storageOptions);
        },
        TEST_TIMEOUT,
    );
});
