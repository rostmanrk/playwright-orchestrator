import {
    BaseAdapter,
    TestRunConfig,
    TestStatus,
    TestRunReport,
    HistoryItem,
    SaveTestResultParams,
} from '@playwright-orchestrator/core';
import { injectable, inject } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { RedisConnection } from './redis-connection.js';
import { SetOptions } from 'redis';
import { REDIS_CONFIG, REDIS_CONNECTION } from './symbols.js';

const TEST_INFO = 'TI';
const TESTS = 'T';
const TEST_RUN = 'TR';

@injectable()
export class RedisAdapter extends BaseAdapter {
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

    async getReportData(runId: string): Promise<TestRunReport> {
        const client = await this.connection.getClient();
        const config = await this.loadTestRunConfig(runId);
        if (!config) throw new Error(`Run ${runId} not found`);
        let reports = (await client.lRange(`${this._namePrefix}:${TEST_RUN}:${runId}:report`, 0, -1)).map((el) =>
            JSON.parse(el),
        );

        return {
            runId,
            config,
            tests: reports.map(({ testId, ...report }) => ({
                ...report,
            })),
        };
    }

    async getTestEma(testId: string): Promise<number> {
        const client = await this.connection.getClient();
        return +((await client.get(`${this._namePrefix}:${TEST_INFO}:${testId}:ema`)) ?? 0);
    }

    async saveTestResult({ runId, test, item, historyWindow, newEma }: SaveTestResultParams): Promise<void> {
        const client = await this.connection.getClient();
        const baseTestInfoKey = `${this._namePrefix}:${TEST_INFO}:${test.testId}`;
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
        const report = this.buildReport(test, item, newEma, history);
        const reportKey = `${this._namePrefix}:${TEST_RUN}:${runId}:report`;
        const pipeline = client
            .multi()
            .set(`${baseTestInfoKey}:fails`, report.fails, updateOptions)
            .lPush(reportKey, JSON.stringify({ ...report, testId: test.testId }))
            .expire(reportKey, this.ttl);
        if (item.status === TestStatus.Failed) {
            pipeline.rPush(`${this._namePrefix}:${TESTS}:${runId}:failed`, JSON.stringify(test));
        }
        await pipeline.exec();
    }

    private async loadTestRunConfig(runId: string): Promise<TestRunConfig> {
        const client = await this.connection.getClient();
        const baseKey = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const config = await client.get(`${baseKey}:config`);
        if (!config) {
            throw new Error(`Run ${runId} not found`);
        }
        return JSON.parse(config);
    }
}
