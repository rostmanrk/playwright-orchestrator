import { TestItem, TestRunInfo, Adapter, TestRunConfig, RunStatus, TestConfig } from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args';
import {
    DynamoDBClient,
    CreateTableCommand,
    DescribeTableCommand,
    UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    BatchWriteCommand,
    QueryCommand,
    DeleteCommand,
    GetCommand,
    UpdateCommand,
} from '@aws-sdk/lib-dynamodb';

const OFFSET_STEP = 100_000_000;
enum StatusOffset {
    Pending = 0,
    Running = 1 * OFFSET_STEP,
    Succeed = 2 * OFFSET_STEP,
    Failed = 3 * OFFSET_STEP,
}

// Describe the fields of the DynamoDB table. Field names are shortened to save space.
enum Fields {
    Id = 'pk',
    Order = 'sk',
    Line = 'l',
    Character = 'c',
    File = 'f',
    Project = 'p',
    Timeout = 't',
    Ttl = 'ttl',
    Config = 'cfg',
}

interface TestItemDb {
    [Fields.Id]: string;
    [Fields.Order]: number;
    [Fields.Line]: string;
    [Fields.Character]: string;
    [Fields.File]: string;
    [Fields.Project]: string;
    [Fields.Timeout]: number;
    [Fields.Ttl]: number;
}

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
        this.client = new DynamoDBClient({ endpoint: createArgs.endpointUrl });
        this.docClient = DynamoDBDocumentClient.from(this.client);
        this.testsTableName = `${createArgs.tableNamePrefix}-tests`;
        this.ttl = createArgs.ttl * 24 * 60 * 60;
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const configRequest = await this.docClient.send(
            new GetCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
            }),
        );
        if (!configRequest.Item) {
            throw new Error(`Run ${runId} not found.`);
        }
        const config = this.mapDbConfigToTestRunConfig(configRequest.Item);
        const status: RunStatus = configRequest.Item[Fields.Config].status;
        if (status === RunStatus.Created || status === RunStatus.Finished) {
            const newStatus = status === RunStatus.Finished ? RunStatus.Rerun : RunStatus.Run;
            config.status = newStatus;
            await this.updateConfigStatus(runId, newStatus);
            // If the run is finished, rerun the failed tests
            // Making sure that failed tests updated only by initial shards
            // Multiple runs of failed tests are possible but very unlikely
            await this.updateFailedTests(runId);
        }
        return config;
    }

    private async updateFailedTests(runId: string): Promise<void> {
        let test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        while (test) {
            await this.addTestItem(runId, test, StatusOffset.Pending);
            test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        }
    }

    async updateConfigStatus(runId: string, status: RunStatus): Promise<void> {
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

    async finishShard(runId: string): Promise<void> {
        await this.updateConfigStatus(runId, RunStatus.Finished);
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        return await this.getNextTestByStatus(runId, StatusOffset.Pending);
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
        return this.mapDbToTestItem(queryOutput.Items![0] as TestItemDb);
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

    async finishTest(runId: string, test: TestItem): Promise<void> {
        // await this.addTestItem(runId, test, StatusOffset.Succeed);
    }

    async failTest(runId: string, test: TestItem): Promise<void> {
        await this.addTestItem(runId, test, StatusOffset.Failed);
    }

    private async addTestItem(runId: string, test: TestItem, status: StatusOffset): Promise<void> {
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: this.mapTestItemToDb(runId, test, status),
            }),
        );
    }

    async saveTestRun(runId: string, testRun: TestRunInfo, args: string[]): Promise<void> {
        await this.saveConfig(runId, testRun.config, args);
        const tests = this.flattenTestRun(testRun.testRun);
        // split the tests into batches to avoid exceeding the 25-item limit
        for (let i = 0; i < tests.length; i += 25) {
            await this.saveTestsBatch(runId, tests.slice(i, i + 25));
        }
    }

    async saveTestsBatch(runId: string, tests: TestItem[]): Promise<void> {
        await this.docClient.send(
            new BatchWriteCommand({
                RequestItems: {
                    [this.testsTableName]: tests.map((test) => ({
                        PutRequest: { Item: this.mapTestItemToDb(runId, test) },
                    })),
                },
            }),
        );
    }

    private async saveConfig(runId: string, config: TestConfig, args: string[]): Promise<void> {
        await this.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: {
                    [Fields.Id]: runId,
                    [Fields.Order]: 0,
                    [Fields.Config]: {
                        ...config,
                        args,
                        status: RunStatus.Created,
                        updated: Date.now(),
                    },
                    [Fields.Ttl]: this.getTtl(),
                },
            }),
        );
    }

    async initialize(): Promise<void> {
        await this.createTestsTable();
        await this.enableTtl();
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

    private mapTestItemToDb(
        runId: string,
        { position, order, file, project, timeout }: TestItem,
        status: StatusOffset = StatusOffset.Pending,
    ): TestItemDb {
        const [line, character] = position.split(':');
        return {
            [Fields.Id]: runId,
            [Fields.Order]: (order % OFFSET_STEP) + status,
            [Fields.Line]: line,
            [Fields.Character]: character,
            [Fields.File]: file,
            [Fields.Project]: project,
            [Fields.Timeout]: timeout,
            [Fields.Ttl]: this.getTtl(),
        };
    }

    private mapDbToTestItem({
        [Fields.Order]: order,
        [Fields.Line]: line,
        [Fields.Character]: character,
        [Fields.File]: file,
        [Fields.Project]: project,
        [Fields.Timeout]: timeout,
    }: TestItemDb): TestItem {
        return {
            position: `${line}:${character}`,
            file,
            project,
            order,
            timeout,
        };
    }

    private mapDbConfigToTestRunConfig(config: any): TestRunConfig {
        return config[Fields.Config] as TestRunConfig;
    }
}
