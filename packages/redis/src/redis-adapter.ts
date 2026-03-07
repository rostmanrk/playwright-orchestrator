import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    ReporterTestItem,
    TestSortItem,
    TestRunReport,
    HistoryItem,
    SaveTestResultParams,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { createClient, RedisClientType, SetOptions } from 'redis';

const TEST_INFO = 'TI';
const TESTS = 'T';
const TEST_RUN = 'TR';

export class RedisAdapter extends Adapter {
    private readonly _client: RedisClientType;
    private readonly _namePrefix: string;
    private readonly ttl: number;
    constructor({ connectionString, namePrefix, ttl }: CreateArgs) {
        super();
        this._namePrefix = namePrefix;
        this._client = createClient({
            url: connectionString,
        });
        this.ttl = ttl * 24 * 60 * 60;
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const client = await this.getClient();
        const res = await client.lPop(`${this._namePrefix}:${TESTS}:${runId}:queue`);
        return res ? JSON.parse(res) : undefined;
    }

    async initialize(): Promise<void> {}

    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.getClient();
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const statusKey = `${key}:status`;
        const updatedKey = `${key}:updated`;
        const dbStatus = await client.get(statusKey);
        if (!dbStatus) {
            throw new Error(`Run ${runId} not found`);
        }
        const status = +dbStatus as RunStatus;

        if (status === RunStatus.Created || status === RunStatus.Finished) {
            const transaction = client.multi();
            if (status === RunStatus.Finished) {
                const queueKey = `${this._namePrefix}:${TESTS}:${runId}`;
                const script = `
                    local items = redis.call('LRANGE', KEYS[1], 0, -1)
                    redis.call('DEL', KEYS[1])
                    return items
                    `;

                // Execute the script
                const res = ((await client.eval(script, { keys: [`${queueKey}:failed`] })) ?? []) as string[];
                const elements = res.map((el: string) => JSON.parse(el));
                elements.sort((a, b) => a.order - b.order);
                for (const el of elements) {
                    transaction.rPush(`${queueKey}:queue`, JSON.stringify(el));
                }
            }
            transaction.set(statusKey, status === RunStatus.Created ? RunStatus.Run : RunStatus.RepeatRun);
            transaction.set(updatedKey, new Date().getTime());
            await transaction.exec();
        }
        return this.loadTestRunConfig(runId);
    }

    async finishShard(runId: string): Promise<void> {
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const client = await this.getClient();
        // set 'updated' field to current time as test run exhausted all tests
        // update 'updated' field until last shard set correct finish time
        await Promise.all([
            client.set(`${key}:status`, RunStatus.Finished),
            client.set(`${key}:updated`, new Date().getTime()),
        ]);
    }

    async dispose(): Promise<void> {
        if (this._client.isOpen) {
            await this._client.quit();
        }
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const client = await this.getClient();
        const config = await this.loadTestRunConfig(runId);
        if (!config) throw new Error(`Run ${runId} not found`);
        let reports = (await client.lRange(`${this._namePrefix}:${TEST_RUN}:${runId}:report`, 0, -1)).map((el) =>
            JSON.parse(el),
        );

        const reportTests = new Set<string>();
        reports = reports.filter((report) => {
            if (reportTests.has(report.testId)) {
                return false;
            }
            reportTests.add(report.testId);
            return true;
        });

        return {
            runId,
            config,
            tests: reports,
        };
    }

    async loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
        const client = await this.getClient();
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

    async saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void> {
        const client = await this.getClient();
        const baseTestRunKey = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const setOptions: SetOptions = { EX: this.ttl };
        const pipeline = client
            .multi()
            .set(`${baseTestRunKey}:config`, JSON.stringify(config), setOptions)
            .set(`${baseTestRunKey}:status`, RunStatus.Created, setOptions)
            .set(`${baseTestRunKey}:updated`, new Date().getTime(), setOptions);
        for (const test of tests) {
            pipeline.rPush(`${this._namePrefix}:${TESTS}:${runId}:queue`, JSON.stringify(test));
        }
        await pipeline.exec();
    }

    async getTestEma(testId: string): Promise<number> {
        const client = await this.getClient();
        return +((await client.get(`${this._namePrefix}:${TEST_INFO}:${testId}:ema`)) ?? 0);
    }

    async saveTestResult({ runId, testId, test, item, historyWindow, newEma, title }: SaveTestResultParams): Promise<void> {
        const client = await this.getClient();
        const baseTestInfoKey = `${this._namePrefix}:${TEST_INFO}:${testId}`;
        const updateOptions: SetOptions = { EX: this.ttl };
        await client
            .multi()
            .rPush(`${baseTestInfoKey}:history`, JSON.stringify(item))
            .expire(`${baseTestInfoKey}:history`, this.ttl)
            .eval(
                `local length = redis.call('LLEN', KEYS[1])
                local maxItems = tonumber(ARGV[1])
                if length > maxItems then
                    redis.call('LPOP', KEYS[1], length - maxItems)
                end`,
                { keys: [`${baseTestInfoKey}:history`], arguments: [historyWindow.toString()] },
            )
            .set(`${baseTestInfoKey}:updated`, item.updated, updateOptions)
            .set(`${baseTestInfoKey}:ema`, newEma, updateOptions)
            .exec();
        const history: HistoryItem[] = (await client.lRange(`${baseTestInfoKey}:history`, 0, -1)).map((el) =>
            JSON.parse(el),
        );
        const report = this.buildReport(test, item, title, newEma, history);
        const reportKey = `${this._namePrefix}:${TEST_RUN}:${runId}:report`;
        const pipeline = client
            .multi()
            .set(`${baseTestInfoKey}:fails`, report.fails)
            .expire(`${baseTestInfoKey}:fails`, this.ttl)
            .lPush(reportKey, JSON.stringify({ ...report, testId }))
            .expire(reportKey, this.ttl);
        if (item.status === TestStatus.Failed) {
            pipeline.rPush(`${this._namePrefix}:${TESTS}:${runId}:failed`, JSON.stringify(test));
        }
        await pipeline.exec();
    }

    private async loadTestRunConfig(runId: string): Promise<TestRunConfig> {
        const client = await this.getClient();
        const baseKey = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const [config, status, updated] = await client.mGet([
            `${baseKey}:config`,
            `${baseKey}:status`,
            `${baseKey}:updated`,
        ]);
        if (!config || !status || !updated) {
            throw new Error(`Run ${runId} not found`);
        }
        return {
            ...JSON.parse(config),
            status: +status,
            updated: +updated,
        };
    }

    private async getClient(): Promise<RedisClientType> {
        if (!this._client.isOpen) {
            await this._client.connect();
        }
        return this._client;
    }
}
