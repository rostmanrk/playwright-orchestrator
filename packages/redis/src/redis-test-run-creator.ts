import { injectable, inject, injectFromBase } from 'inversify';
import { BaseTestRunCreator, RunStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRun, TestSortItem } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { RedisConnection } from './redis-connection.js';
import { SetOptions } from 'redis';
import { REDIS_CONFIG, REDIS_CONNECTION } from './symbols.js';

const TEST_INFO = 'TI';
const TESTS = 'T';
const TEST_RUN = 'TR';

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
export class RedisTestRunCreator extends BaseTestRunCreator {
    private readonly _namePrefix: string;
    private readonly ttl: number;
    private readonly connection: RedisConnection;

    constructor(
        @inject(REDIS_CONFIG) { namePrefix, ttl }: CreateArgs,
        @inject(REDIS_CONNECTION) connection: RedisConnection,
    ) {
        super();
        this._namePrefix = namePrefix;
        this.ttl = ttl * 24 * 60 * 60;
        this.connection = connection;
    }

    async loadTestInfos(tests: TestItem[]): Promise<Map<string, TestSortItem>> {
        const client = await this.connection.getClient();
        const created = new Date().getTime();
        const ops = client.multi();
        const baseTestInfoKey = `${this._namePrefix}:${TEST_INFO}`;
        const setOptions: SetOptions = { NX: true, EX: this.ttl };
        for (const test of tests) {
            const emaKey = `${baseTestInfoKey}:${test.testId}:ema`;
            const createdKey = `${baseTestInfoKey}:${test.testId}:created`;
            ops.set(emaKey, 0, setOptions).set(createdKey, created, setOptions);
        }
        await ops.exec();

        const emaKeys = tests.map((test) => `${baseTestInfoKey}:${test.testId}:ema`);
        const failsKeys = tests.map((test) => `${baseTestInfoKey}:${test.testId}:fails`);
        const [emaValues, failsValues] = await Promise.all([client.mGet(emaKeys), client.mGet(failsKeys)]);

        const testInfo = new Map<string, TestSortItem>();
        tests.forEach((test, i) => {
            testInfo.set(test.testId, {
                ema: +(emaValues[i] ?? 0),
                fails: +(failsValues[i] ?? 0),
            });
        });
        return testInfo;
    }

    async saveRunData(runId: string, testRun: TestRun, tests: TestItem[]): Promise<void> {
        const client = await this.connection.getClient();
        const baseTestRunKey = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const setOptions: SetOptions = { EX: this.ttl };
        const pipeline = client
            .multi()
            .set(`${baseTestRunKey}:config`, JSON.stringify(testRun.config), setOptions)
            .set(`${baseTestRunKey}:status`, RunStatus.Created, setOptions)
            .set(`${baseTestRunKey}:updated`, testRun.updated, setOptions);
        for (const test of tests) {
            pipeline.rPush(`${this._namePrefix}:${TESTS}:${runId}:queue`, JSON.stringify(test));
        }
        await pipeline.exec();
    }
}
