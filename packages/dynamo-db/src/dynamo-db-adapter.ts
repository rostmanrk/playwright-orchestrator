import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    ReporterTestItem,
    ResultTestParams,
    SaveTestRunParams,
    TestSortItem,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    UpdateTimeToLiveCommand,
    ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    BatchWriteCommand,
    QueryCommand,
    DeleteCommand,
    GetCommand,
    UpdateCommand,
    BatchGetCommand,
} from '@aws-sdk/lib-dynamodb';
import { TestRunReport } from '../../core/dist/types/reporter.js';
import {
    idToStatus,
    mapDbTestInfoToSortItem,
    mapDbToTestItem,
    mapTestInfoItemToReport,
    mapTestItemToDb,
    parseStatus,
} from './helpers.js';
import { Fields, OFFSET_STEP, StatusOffset } from './constants.js';
import { DynamoResultTestParams, TestInfoItem, TestItemDb } from './types.js';

export class DynamoDbAdapter extends Adapter {
    private readonly client: DynamoDBClient;
    private readonly docClient: DynamoDBClient;
    private readonly testsTableName: string;
    /**
     * The time-to-live (TTL) value for the DynamoDB items.
     * This value determines the expiration time for the items stored in the database.
     * It is specified in days.
     */
    private readonly ttl: number;
    constructor(createArgs: CreateArgs) {
        super();
        this.client = new DynamoDBClient({ endpoint: createArgs.endpointUrl, maxAttempts: 10 });
        this.docClient = DynamoDBDocumentClient.from(this.client);
        this.testsTableName = `${createArgs.tableNamePrefix}-tests`;
        this.ttl = createArgs.ttl * 24 * 60 * 60;
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const config = await this.getConfig(runId);
        const status: RunStatus = config.status;
        if (status === RunStatus.Created || status === RunStatus.Finished) {
            const newStatus = status === RunStatus.Finished ? RunStatus.RepeatRun : RunStatus.Run;
            config.status = newStatus;
            await this.updateConfigStatus(runId, newStatus);
            // If the run is finished, rerun the failed tests
            // Making sure that failed tests updated only by initial shards
            // Multiple runs of failed tests are possible but very unlikely
            await this.updateFailedTests(runId, config);
        }
        return config;
    }

    async finishShard(runId: string): Promise<void> {
        await this.updateConfigStatus(runId, RunStatus.Finished);
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        return await this.getNextTestByStatus(runId, StatusOffset.Pending);
    }

    async finishTest(params: ResultTestParams): Promise<void> {
        await this.addTestItem(StatusOffset.Succeed, params);
    }

    async failTest(params: ResultTestParams): Promise<void> {
        await this.addTestItem(StatusOffset.Failed, params);
    }

    async saveTestRun(params: SaveTestRunParams): Promise<void> {
        const { runId, testRun, historyWindow } = params;
        let tests = this.transformTestRunToItems(testRun.testRun);
        const historyItemMap = await this.loadTestInfoItems(tests);
        tests = this.sortTests(tests, historyItemMap, { historyWindow });
        await this.saveConfig(params);

        // split the tests into batches to avoid exceeding the 25-item limit
        for (let i = 0; i < tests.length; i += 25) {
            await this.saveTestsBatch(runId, tests.slice(i, i + 25));
        }
    }

    async initialize(): Promise<void> {
        await this.createTestsTable();
        await this.enableTtl();
    }

    async dispose(): Promise<void> {
        this.client.destroy();
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const config = await this.getConfig(runId);
        const tests = await this.queryAllTests(runId);
        return {
            runId,
            config: config,
            tests: tests.map((test) => {
                const report = test[Fields.Report];
                return {
                    file: test[Fields.File],
                    project: test[Fields.Project],
                    position: `${test[Fields.Line]}:${test[Fields.Character]}`,
                    status: idToStatus(test[Fields.Order]),
                    title: report?.[Fields.Title] ?? '',
                    fails: report?.[Fields.Fails] ?? 0,
                    lastSuccessfulRunTimestamp: report?.[Fields.LastSuccess] ?? 0,
                    duration: report?.[Fields.Duration] ?? 0,
                    averageDuration: report?.[Fields.EMA] ?? 0,
                };
            }),
        };
    }

    private async getConfig(runId: string): Promise<TestRunConfig> {
        const configRequest = await this.docClient.send(
            new GetCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
            }),
        );
        if (!configRequest.Item) {
            throw new Error(`Run ${runId} not found.`);
        }
        return configRequest.Item[Fields.Config] as TestRunConfig;
    }

    private async getNextTestByStatus(runId: string, status: StatusOffset): Promise<TestItem | undefined> {
        let deleted = false;
        let test: TestItem | undefined = undefined;
        while (!deleted) {
            test = await this.queryNextTest(runId, status);
            if (!test) return;
            deleted = await this.tryToDeleteItem(runId, test.order);
        }
        return test;
    }

    private async updateFailedTests(runId: string, config: TestRunConfig): Promise<void> {
        let test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        while (test) {
            await this.addTestItem(StatusOffset.Pending, { runId, test, config });
            test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        }
    }

    private async queryNextTest(runId: string, start: number): Promise<TestItem | undefined> {
        const queryOutput = await this.docClient.send(
            new QueryCommand({
                TableName: this.testsTableName,
                KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :start AND :end',
                ExpressionAttributeNames: {
                    '#pk': Fields.Id,
                    '#sk': Fields.Order,
                },
                ExpressionAttributeValues: {
                    ':pk': runId,
                    ':start': 1 + start,
                    ':end': start + OFFSET_STEP - 1,
                },
                Limit: 1,
            }),
        );
        if (queryOutput.Count === 0) return;
        return mapDbToTestItem(queryOutput.Items![0] as TestItemDb);
    }

    private async updateConfigStatus(runId: string, status: RunStatus): Promise<void> {
        await this.docClient.send(
            new UpdateCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
                UpdateExpression: 'SET #cfg.#status = :status, #cfg.#updated = :updated',
                ExpressionAttributeNames: {
                    '#cfg': Fields.Config,
                    '#status': 'status',
                    '#updated': 'updated',
                },
                ExpressionAttributeValues: {
                    ':status': status,
                    ':updated': Date.now(),
                },
            }),
        );
    }

    private async tryToDeleteItem(runId: string, order: number): Promise<boolean> {
        try {
            await this.docClient.send(
                new DeleteCommand({
                    TableName: this.testsTableName,
                    Key: { [Fields.Id]: runId, [Fields.Order]: order },
                    ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
                    ExpressionAttributeNames: { '#pk': Fields.Id, '#sk': Fields.Order },
                }),
            );
            return true;
        } catch (error) {
            return false;
        }
    }

    private async addTestItem(status: StatusOffset, params: DynamoResultTestParams): Promise<void> {
        const { runId, test } = params;
        const stats = await this.updateTestInfo(params);
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: {
                    ...mapTestItemToDb(runId, this.getTtl(), test, status),
                    [Fields.Report]: mapTestInfoItemToReport(stats, params),
                },
            }),
        );
    }

    private async updateTestInfo(args: DynamoResultTestParams, retry = 0): Promise<TestInfoItem | undefined> {
        const { test, testResult, config } = args;
        try {
            if (!testResult) return;
            const id = this.getTestId({ ...test, ...testResult });
            const stats = await this.getTestInfo(id);
            if (!stats) return;
            const history = [...stats[Fields.History]];
            history.push({
                [Fields.Duration]: testResult.duration,
                [Fields.Updated]: Date.now(),
                [Fields.Status]: parseStatus(testResult.status),
            });
            if (history.length > config.historyWindow) history.splice(0, history.length - config.historyWindow);
            const ema = this.calculateEMA(testResult.duration, stats[Fields.EMA], config.historyWindow);
            await this.saveTestInfoItem({ ...stats, [Fields.History]: history, [Fields.EMA]: ema });
            return stats;
        } catch (error: any) {
            if (!(error instanceof ConditionalCheckFailedException) || retry >= 5) {
                throw error;
            }
            return this.updateTestInfo(args, retry + 1);
        }
    }

    private async getTestInfo(id: string): Promise<TestInfoItem | null> {
        const { Items } = await this.docClient.send(
            new QueryCommand({
                TableName: this.testsTableName,
                KeyConditionExpression: '#pk = :pk',
                ExpressionAttributeNames: { '#pk': Fields.Id },
                ExpressionAttributeValues: { ':pk': id },
                Limit: 1,
            }),
        );
        if (!Items || Items.length === 0) return null;
        return Items[0] as TestInfoItem;
    }

    private async queryAllTests(runId: string): Promise<TestItemDb[]> {
        const { Items } = await this.docClient.send(
            new QueryCommand({
                TableName: this.testsTableName,
                KeyConditionExpression: '#pk = :pk AND #sk > :start',
                ExpressionAttributeNames: { '#pk': Fields.Id, '#sk': Fields.Order },
                ExpressionAttributeValues: { ':pk': runId, ':start': 0 },
            }),
        );
        return Items as TestItemDb[];
    }

    private async saveTestInfoItem(item: TestInfoItem): Promise<void> {
        await this.docClient.send(
            new UpdateCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: item[Fields.Id], [Fields.Order]: item[Fields.Order] },
                UpdateExpression: 'SET #h = :h, #ttl = :ttl, #v = #v + :inc, #ema = :ema',
                ExpressionAttributeNames: {
                    '#h': Fields.History,
                    '#ttl': Fields.Ttl,
                    '#v': Fields.Version,
                    '#ema': Fields.EMA,
                },
                ExpressionAttributeValues: {
                    ':h': item[Fields.History],
                    ':ttl': this.getTtl(),
                    ':ema': item[Fields.EMA],
                    ':v': item[Fields.Version],
                    ':inc': 1,
                },
                ConditionExpression: '#v = :v',
            }),
        );
    }

    private async saveTestsBatch(runId: string, tests: TestItem[]): Promise<void> {
        await this.docClient.send(
            new BatchWriteCommand({
                RequestItems: {
                    [this.testsTableName]: tests.map((test) => ({
                        PutRequest: { Item: mapTestItemToDb(runId, this.getTtl(), test) },
                    })),
                },
            }),
        );
    }

    private async loadTestInfoItems(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
        const testInfos = await this.queryTestInfo(tests);
        const foundTestMap = new Map<string, TestSortItem>();
        for (const item of testInfos) {
            foundTestMap.set(item[Fields.Id], mapDbTestInfoToSortItem(item));
        }
        for (const test of tests) {
            if (!foundTestMap.has(test.testId)) {
                const testInfo = await this.createNewTestInfoItem(test.testId);
                foundTestMap.set(test.testId, mapDbTestInfoToSortItem(testInfo));
            }
        }
        return foundTestMap;
    }

    private async queryTestInfo(tests: ReporterTestItem[]): Promise<TestInfoItem[]> {
        const testInfos: TestInfoItem[] = [];
        for (var i = 0; i < tests.length; i += 100) {
            const { Responses } = await this.docClient.send(
                new BatchGetCommand({
                    RequestItems: {
                        [this.testsTableName]: {
                            Keys: tests.map((test) => ({
                                [Fields.Id]: test.testId,
                                [Fields.Order]: 0,
                            })),
                        },
                    },
                }),
            );
            testInfos.push(...((Responses?.[this.testsTableName] as any[]) ?? []));
        }
        return testInfos;
    }

    private async createNewTestInfoItem(id: string): Promise<TestInfoItem> {
        const item = {
            [Fields.Id]: id,
            [Fields.Order]: 0,
            [Fields.Created]: Date.now(),
            [Fields.EMA]: 0,
            [Fields.History]: [],
            [Fields.Ttl]: this.getTtl(),
            [Fields.Version]: 1,
        };
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: item,
            }),
        );
        return item;
    }

    private async saveConfig({ runId, args, historyWindow, testRun }: SaveTestRunParams): Promise<void> {
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: {
                    [Fields.Id]: runId,
                    [Fields.Order]: 0,
                    [Fields.Config]: {
                        ...testRun.config,
                        args,
                        status: RunStatus.Created,
                        updated: Date.now(),
                        historyWindow,
                    },
                    [Fields.Ttl]: this.getTtl(),
                },
            }),
        );
    }

    private async enableTtl(): Promise<void> {
        await this.client.send(
            new UpdateTimeToLiveCommand({
                TableName: this.testsTableName,
                TimeToLiveSpecification: { AttributeName: Fields.Ttl, Enabled: true },
            }),
        );
    }

    private async createTestsTable(): Promise<void> {
        await this.client.send(
            new CreateTableCommand({
                TableName: this.testsTableName,
                AttributeDefinitions: [
                    { AttributeName: Fields.Id, AttributeType: 'S' },
                    { AttributeName: Fields.Order, AttributeType: 'N' },
                ],
                KeySchema: [
                    { AttributeName: Fields.Id, KeyType: 'HASH' },
                    { AttributeName: Fields.Order, KeyType: 'RANGE' },
                ],
                BillingMode: 'PAY_PER_REQUEST',
            }),
        );
        let created = false;
        do {
            await new Promise((resolve) => setTimeout(resolve, 1500));
            const res = await this.client.send(
                new DescribeTableCommand({
                    TableName: this.testsTableName,
                }),
            );
            created = res.Table?.TableStatus === 'ACTIVE';
        } while (!created);
    }

    private getTtl(): number {
        // The time-to-live (TTL) value for the DynamoDB items. It is specified in seconds.
        return Math.floor(Date.now() / 1000) + this.ttl;
    }
}
