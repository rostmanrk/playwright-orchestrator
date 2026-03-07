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
import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    UpdateTimeToLiveCommand,
    TransactionCanceledException,
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
    TransactWriteCommand,
} from '@aws-sdk/lib-dynamodb';
import { idToStatus, mapDbTestInfoToSortItem, mapDbToTestItem, mapTestItemToDb } from './helpers.js';
import { Fields, OFFSET_STEP, StatusOffset } from './constants.js';
import { TestInfoItem, TestItemDb } from './types.js';

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

    async loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
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

    async saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void> {
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: {
                    [Fields.Id]: runId,
                    [Fields.Order]: 0,
                    [Fields.Config]: {
                        ...config,
                        status: RunStatus.Created,
                        updated: Date.now(),
                    },
                    [Fields.Ttl]: this.getTtl(),
                },
            }),
        );
        for (let i = 0; i < tests.length; i += 25) {
            await this.saveTestsBatch(runId, tests.slice(i, i + 25));
        }
    }

    async getTestEma(testId: string): Promise<number> {
        const stats = await this.getTestInfo(testId);
        return stats?.[Fields.EMA] ?? 0;
    }

    async saveTestResult(params: SaveTestResultParams): Promise<void> {
        return this.saveTestResultWithRetry(params, 0);
    }

    private async saveTestResultWithRetry(params: SaveTestResultParams, retry: number): Promise<void> {
        const { runId, testId, test, item, historyWindow, newEma, title } = params;
        try {
            const stats = await this.getTestInfo(testId);
            if (!stats) return;
            const history = [
                ...stats[Fields.History],
                {
                    [Fields.Duration]: item.duration,
                    [Fields.Updated]: item.updated,
                    [Fields.Status]: item.status,
                },
            ];
            if (history.length > historyWindow) history.splice(0, history.length - historyWindow);
            const historyItems: HistoryItem[] = history.map((h) => ({
                status: h[Fields.Status] as TestStatus,
                duration: h[Fields.Duration],
                updated: h[Fields.Updated],
            }));
            const report = this.buildReport(test, item, title, newEma, historyItems);
            const status = item.status === TestStatus.Failed ? StatusOffset.Failed : StatusOffset.Succeed;
            await this.docClient.send(
                new TransactWriteCommand({
                    TransactItems: [
                        {
                            Update: {
                                TableName: this.testsTableName,
                                Key: { [Fields.Id]: stats[Fields.Id], [Fields.Order]: stats[Fields.Order] },
                                UpdateExpression: 'SET #h = :h, #ttl = :ttl, #v = #v + :inc, #ema = :ema',
                                ConditionExpression: '#v = :v',
                                ExpressionAttributeNames: {
                                    '#h': Fields.History,
                                    '#ttl': Fields.Ttl,
                                    '#v': Fields.Version,
                                    '#ema': Fields.EMA,
                                },
                                ExpressionAttributeValues: {
                                    ':h': history,
                                    ':ttl': this.getTtl(),
                                    ':ema': newEma,
                                    ':v': stats[Fields.Version],
                                    ':inc': 1,
                                },
                            },
                        },
                        {
                            Put: {
                                TableName: this.testsTableName,
                                Item: {
                                    ...mapTestItemToDb(runId, this.getTtl(), test, status),
                                    [Fields.Report]: {
                                        [Fields.Duration]: report.duration,
                                        [Fields.EMA]: report.averageDuration,
                                        [Fields.Title]: report.title,
                                        [Fields.Fails]: report.fails,
                                        [Fields.LastSuccess]: report.lastSuccessfulRunTimestamp ?? 0,
                                    },
                                },
                            },
                        },
                    ],
                }),
            );
        } catch (error) {
            const isVersionConflict =
                error instanceof TransactionCanceledException &&
                error.CancellationReasons?.some((r) => r.Code === 'ConditionalCheckFailed');
            if (!isVersionConflict || retry >= 5) throw error;
            return this.saveTestResultWithRetry(params, retry + 1);
        }
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
            await this.addPendingTestItem(runId, test);
            test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        }
    }

    private async addPendingTestItem(runId: string, test: TestItem): Promise<void> {
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: mapTestItemToDb(runId, this.getTtl(), test, StatusOffset.Pending),
            }),
        );
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
