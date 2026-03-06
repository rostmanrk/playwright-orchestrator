import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
    TestSortItem,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { createClient, RedisClientType, SetOptions } from 'redis';
import { TestReport, TestRunReport } from '../../core/dist/types/reporter.js';

const TEST_INFO = 'TI';
const TESTS = 'T';
const TEST_RUN = 'TR';

export class RedisAdapter extends Adapter {
    private readonly _client: RedisClientType;
    private readonly _namePrefix: string;
    private ttl: number;
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

    async finishTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResults(TestStatus.Passed, params);
    }

    async failTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResults(TestStatus.Failed, params);
    }

    async saveTestRun({ runId, args, historyWindow, testRun }: SaveTestRunParams): Promise<void> {
        const client = await this.getClient();
        let tests = this.transformTestRunToItems(testRun.testRun);
        const testInfos = await this.loadTestInfos(tests);
        tests = this.sortTests(tests, testInfos, { historyWindow });
        await this.saveConfig(runId, { ...testRun.config, args, historyWindow });
        for (const test of tests) {
            client.rPush(`${this._namePrefix}:${TESTS}:${runId}:queue`, JSON.stringify(test));
        }
    }

    async initialize(): Promise<void> {}

    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.getClient();
        var key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const statusKey = `${key}:status`;
        const updatedKey = `${key}:updated`;
        const [dbStatus, dpUpdated] = await client.mGet([statusKey, updatedKey]);
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
        var key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
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

        var reportTests = new Set<string>();
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

    private async updateTestWithResults(
        status: TestStatus,
        { runId, test, config, testResult }: ResultTestParams,
    ): Promise<void> {
        const client = await this.getClient();
        const updated = new Date().getTime();
        const testId = this.getTestId({ ...test, ...testResult });
        const baseTestInfoKey = `${this._namePrefix}:${TEST_INFO}:${testId}`;
        const ema = +((await this._client.get(`${baseTestInfoKey}:ema`)) ?? 0);
        const newEma = this.calculateEMA(testResult.duration, ema, config.historyWindow);
        const updateOptions: SetOptions = { EX: this.ttl };
        await client
            .multi()
            .rPush(`${baseTestInfoKey}:history`, JSON.stringify({ status, duration: testResult.duration, updated }))
            .expire(`${baseTestInfoKey}:history`, this.ttl)
            .eval(
                `local length = redis.call('LLEN', KEYS[1])
                local maxItems = tonumber(ARGV[1])
                if length > maxItems then
                    redis.call('LPOP', KEYS[1], length - maxItems)
                end`,
                { keys: [`${baseTestInfoKey}:history`], arguments: [config.historyWindow.toString()] },
            )
            .set(`${baseTestInfoKey}:updated`, updated, updateOptions)
            .set(`${baseTestInfoKey}:ema`, newEma, updateOptions)
            .exec();

        const history = (await client.lRange(`${baseTestInfoKey}:history`, 0, -1)).map((el) => JSON.parse(el));
        const reportKey = `${this._namePrefix}:${TEST_RUN}:${runId}:report`;

        const report = {
            testId,
            file: test.file,
            position: test.position,
            project: test.project,
            status,
            title: testResult.title,
            duration: testResult.duration,
            fails: history.filter((el) => el.status === TestStatus.Failed).length,
            averageDuration: newEma,
            lastSuccessfulRunTimestamp: history.findLast((el) => el.status === TestStatus.Passed)?.updated,
        };
        const transaction = client.multi();
        if (status === TestStatus.Failed) {
            transaction.rPush(`${this._namePrefix}:${TESTS}:${runId}:failed`, JSON.stringify(test));
        }
        await transaction.lPush(reportKey, JSON.stringify(report)).expire(reportKey, this.ttl).exec();
    }

    private async saveConfig(runId: string, config: any) {
        const client = await this.getClient();
        const baseKey = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const setOptions: SetOptions = { EX: this.ttl };
        await client
            .multi()
            .set(`${baseKey}:config`, JSON.stringify(config), setOptions)
            .set(`${baseKey}:status`, RunStatus.Created, setOptions)
            .set(`${baseKey}:updated`, new Date().getTime(), setOptions)
            .exec();
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

    private async loadTestInfos(tests: ReporterTestItem[]) {
        const client = await this.getClient();
        const created = new Date().getTime();
        const ops = await client.multi();
        const baseKey = `${this._namePrefix}:${TEST_INFO}`;

        const setOptions: SetOptions = { NX: true, EX: this.ttl };
        for (const test of tests) {
            const emaKey = `${baseKey}:${test.testId}:ema`;
            const createdKey = `${baseKey}:${test.testId}:created`;
            ops.set(emaKey, 0, setOptions).set(createdKey, created, setOptions);
        }
        await ops.exec();
        const testInfo = new Map<string, TestSortItem>();
        for (const test of tests) {
            const emaKey = `${baseKey}:${test.testId}:ema`;
            const failsKey = `${baseKey}:${test.testId}:fails`;
            testInfo.set(test.testId, {
                ema: +((await client.get(emaKey)) ?? 0),
                fails: +((await client.lLen(failsKey)) ?? 0),
            });
        }
        return testInfo;
    }

    private async getClient(): Promise<RedisClientType> {
        if (!this._client.isOpen) {
            await this._client.connect();
        }
        return this._client;
    }

    private mapConfig(dbConfig: any): TestRunConfig {
        return {
            ...dbConfig.config,
            updated: dbConfig.updated.getTime(),
            status: dbConfig.status,
        };
    }
}
