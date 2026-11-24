import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { testAbandonedClaims } from '../utils/test-abandoned-claims.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';
import { PostgreSqlContainer, StartedPostgreSqlContainer } from '@testcontainers/postgresql';

const reportsFolder = './test-reports-folder-pg';
let container: StartedPostgreSqlContainer | undefined;
let storageOptions: string[];

beforeAll(async () => {
    const connectionString = process.env.PG_CONNECTION_STRING;
    if (connectionString) {
        storageOptions = ['pg', '--connection-string', connectionString];
    } else {
        container = await new PostgreSqlContainer('postgres:13.3-alpine').start();
        storageOptions = ['pg', '--connection-string', container.getConnectionUri()];
    }
}, 60000);

afterAll(async () => {
    await container?.stop();
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('PostgreSQL plugin', () => {
    it(
        'test pg plugin',
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
