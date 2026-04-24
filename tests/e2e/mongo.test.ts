import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

const reportsFolder = './test-reports-folder-mongo';
let container: StartedTestContainer | undefined;
let storageOptions: string[];

beforeAll(async () => {
    const connectionString = process.env.MONGO_CONNECTION_STRING;
    if (connectionString) {
        storageOptions = ['mongo', '--connection-string', connectionString, '--db', process.env.MONGO_DB ?? 'test'];
    } else {
        container = await new GenericContainer('mongo:7')
            .withExposedPorts(27017)
            .withWaitStrategy(Wait.forLogMessage(/waiting for connections/i))
            .start();
        const port = container.getMappedPort(27017);
        storageOptions = ['mongo', '--connection-string', `mongodb://${container.getHost()}:${port}/`, '--db', 'test'];
    }
}, 60000);

afterAll(async () => {
    await container?.stop();
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('MongoDB plugin', () => {
    it(
        'grouping by test',
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
});
