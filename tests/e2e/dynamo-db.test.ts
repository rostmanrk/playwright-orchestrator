import { it, afterAll, beforeAll, describe } from 'vitest';
import { rm } from 'node:fs/promises';
import { testStorage } from '../utils/test-storage.js';
import { TEST_TIMEOUT } from '../utils/constants.js';
import { Grouping } from '../../packages/core/src/types/adapters.js';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

const reportsFolder = './test-reports-folder-dynamo';
let container: StartedTestContainer | undefined;
let storageOptions: string[];

beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID = 'local';
    process.env.AWS_SECRET_ACCESS_KEY = 'local';
    process.env.AWS_REGION = 'local';
    const endpointUrl = process.env.DYNAMO_ENDPOINT_URL;
    if (endpointUrl) {
        storageOptions = ['dynamo-db', '--endpoint-url', endpointUrl];
    } else {
        container = await new GenericContainer('amazon/dynamodb-local').withExposedPorts(8000).start();
        storageOptions = [
            'dynamo-db',
            '--endpoint-url',
            `http://${container.getHost()}:${container.getMappedPort(8000)}`,
        ];
    }
}, 60000);

afterAll(async () => {
    await container?.stop();
    await rm(reportsFolder, { recursive: true, force: true });
});

describe('DynamoDb plugin', () => {
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
