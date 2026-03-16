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
import { TransactionCanceledException } from '@aws-sdk/client-dynamodb';
import { QueryCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import { idToStatus, mapTestItemToDb, getTtl } from './helpers.js';
import { Fields, StatusOffset } from './constants.js';
import { TestInfoItem, TestItemDb } from './types.js';
import { DynamoDbConnection } from './dynamo-db-connection.js';
import { DYNAMO_CONFIG, DYNAMO_CONNECTION } from './symbols.js';

@injectable()
export class DynamoDbAdapter extends BaseAdapter {
    private readonly testsTableName: string;
    /**
     * The time-to-live (TTL) value for the DynamoDB items.
     * This value determines the expiration time for the items stored in the database.
     * It is specified in days.
     */
    private readonly ttl: number;
    private readonly connection: DynamoDbConnection;

    constructor(
        @inject(DYNAMO_CONFIG) createArgs: CreateArgs,
        @inject(DYNAMO_CONNECTION) connection: DynamoDbConnection,
    ) {
        super();
        this.connection = connection;
        this.testsTableName = `${createArgs.tableNamePrefix}-tests`;
        this.ttl = createArgs.ttl * 24 * 60 * 60;
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

    async getTestEma(testId: string): Promise<number> {
        const stats = await this.getTestInfo(testId);
        return stats?.[Fields.EMA] ?? 0;
    }

    async saveTestResult(params: SaveTestResultParams): Promise<void> {
        return this.saveTestResultWithRetry(params, 0);
    }

    private async saveTestResultWithRetry(params: SaveTestResultParams, retry: number): Promise<void> {
        const { runId, test, item, historyWindow, newEma, title } = params;
        try {
            const stats = await this.getTestInfo(test.testId);
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
            await this.connection.docClient.send(
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
                                    ':ttl': getTtl(this.ttl),
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
                                    ...mapTestItemToDb(runId, getTtl(this.ttl), test, status),
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
        const configRequest = await this.connection.docClient.send(
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

    private async getTestInfo(id: string): Promise<TestInfoItem | null> {
        const { Items } = await this.connection.docClient.send(
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
        const { Items } = await this.connection.docClient.send(
            new QueryCommand({
                TableName: this.testsTableName,
                KeyConditionExpression: '#pk = :pk AND #sk > :start',
                ExpressionAttributeNames: { '#pk': Fields.Id, '#sk': Fields.Order },
                ExpressionAttributeValues: { ':pk': runId, ':start': 0 },
            }),
        );
        return Items as TestItemDb[];
    }
}
