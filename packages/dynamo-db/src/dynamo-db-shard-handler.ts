import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRunContext } from '@playwright-orchestrator/core';
import { RunStatus, SYMBOLS } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { DynamoDbConnection } from './dynamo-db-connection.js';
import {
    PutCommand,
    QueryCommand,
    DeleteCommand,
    GetCommand,
    UpdateCommand,
    QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { mapDbToTestItem, mapTestItemToDb, getTtl, mapDbToTestRun } from './helpers.js';
import { Fields, OFFSET_STEP, StatusOffset } from './constants.js';
import type { TestItemDb, TestRunDb } from './types.js';
import { DYNAMO_CONFIG, DYNAMO_CONNECTION } from './symbols.js';

@injectable()
export class DynamoDbShardHandler implements ShardHandler {
    private readonly testsTableName: string;
    private readonly ttl: number;
    private readonly connection: DynamoDbConnection;

    constructor(
        @inject(DYNAMO_CONFIG) createArgs: CreateArgs,
        @inject(DYNAMO_CONNECTION) connection: DynamoDbConnection,
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
    ) {
        this.connection = connection;
        this.testsTableName = `${createArgs.tableNamePrefix}-tests`;
        this.ttl = createArgs.ttl * 24 * 60 * 60;
    }

    async startShard(): Promise<TestRunConfig> {
        const { runId, shardId } = this.runContext;
        const testRun = mapDbToTestRun(await this.getTestRun(runId));

        let status = testRun.status;
        if (status === RunStatus.Created || status === RunStatus.Finished) {
            const isRepeat = status === RunStatus.Finished;
            const nextStatus = isRepeat ? RunStatus.RepeatRun : RunStatus.Run;
            const won = await this.tryTransitionStatus(runId, status, nextStatus);
            if (won && isRepeat) {
                const { count, totalEma } = await this.updateFailedTests(runId);
                await this.connection.docClient.send(
                    new UpdateCommand({
                        TableName: this.testsTableName,
                        Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
                        UpdateExpression: 'SET #cfg.#rc = :rc, #cfg.#rt = :rt',
                        ExpressionAttributeNames: {
                            '#cfg': Fields.Config,
                            '#rc': 'remainingCount',
                            '#rt': 'remainingTime',
                        },
                        ExpressionAttributeValues: { ':rc': count, ':rt': totalEma },
                    }),
                );
            }
            status = nextStatus;
        }
        await this.updateTestRun(
            status,
            `#shards.#shardId = if_not_exists(#shards.#shardId, :shard)`,
            { '#shards': Fields.Shards, '#shardId': shardId },
            { ':shard': { shardId, started: Date.now() } },
        );
        return testRun.config;
    }

    async finishShard(): Promise<void> {
        const { shardId } = this.runContext;
        await this.updateTestRun(
            RunStatus.Finished,
            `#shards.#shardId.finished = if_not_exists(#shards.#shardId.finished, :finished)`,
            { '#shards': Fields.Shards, '#shardId': shardId },
            { ':finished': Date.now() },
        );
    }

    async getNextTest(_config: TestRunConfig): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return await this.getNextTestByStatus(runId, StatusOffset.Pending);
    }

    async getNextTestByProject(project: string): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return await this.getNextTestByStatus(runId, StatusOffset.Pending, project);
    }

    private async getTestRun(runId: string): Promise<TestRunDb> {
        const configRequest = await this.connection.docClient.send(
            new GetCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
            }),
        );
        if (!configRequest.Item) throw new Error(`Run ${runId} not found.`);
        return configRequest.Item as TestRunDb;
    }

    private async updateTestRun(
        runStatus: RunStatus,
        updateExpression: string,
        expressionAttributeNames: Record<string, string>,
        expressionAttributeValues: Record<string, unknown>,
    ): Promise<void> {
        const { runId } = this.runContext;
        await this.connection.docClient.send(
            new UpdateCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
                UpdateExpression: `SET #updated = :updated, #status = :status, ${updateExpression}`,
                ExpressionAttributeNames: {
                    '#updated': Fields.Updated,
                    '#status': Fields.Status,
                    ...expressionAttributeNames,
                },
                ExpressionAttributeValues: {
                    ':updated': Date.now(),
                    ':status': runStatus,
                    ...expressionAttributeValues,
                },
            }),
        );
    }

    private async tryTransitionStatus(runId: string, from: RunStatus, to: RunStatus): Promise<boolean> {
        try {
            await this.connection.docClient.send(
                new UpdateCommand({
                    TableName: this.testsTableName,
                    Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
                    UpdateExpression: 'SET #status = :to, #updated = :updated',
                    ConditionExpression: '#status = :from',
                    ExpressionAttributeNames: { '#status': Fields.Status, '#updated': Fields.Updated },
                    ExpressionAttributeValues: { ':from': from, ':to': to, ':updated': Date.now() },
                }),
            );
            return true;
        } catch (e) {
            if (e instanceof ConditionalCheckFailedException) return false;
            throw e;
        }
    }

    private async getNextTestByStatus(
        runId: string,
        status: StatusOffset,
        project?: string,
    ): Promise<TestItem | undefined> {
        let deleted = false;
        let test: TestItem | undefined = undefined;
        while (!deleted) {
            test = await this.queryNextTest(runId, status, project);
            if (!test) return;
            deleted = await this.tryToDeleteItem(runId, test.order);
        }
        if (status === StatusOffset.Pending) {
            await this.connection.docClient.send(
                new UpdateCommand({
                    TableName: this.testsTableName,
                    Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
                    UpdateExpression:
                        'SET #cfg.#rc = if_not_exists(#cfg.#rc, :zero) + :rc, #cfg.#rt = if_not_exists(#cfg.#rt, :zero) + :rt',
                    ExpressionAttributeNames: {
                        '#cfg': Fields.Config,
                        '#rc': 'remainingCount',
                        '#rt': 'remainingTime',
                    },
                    ExpressionAttributeValues: {
                        ':zero': 0,
                        ':rc': -1,
                        ':rt': -test!.ema,
                    },
                }),
            );
        }
        return test;
    }

    private async updateFailedTests(runId: string): Promise<{ count: number; totalEma: number }> {
        let count = 0;
        let totalEma = 0;
        let test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        while (test) {
            await this.addPendingTestItem(runId, test);
            count++;
            totalEma += test.ema;
            test = await this.getNextTestByStatus(runId, StatusOffset.Failed);
        }
        return { count, totalEma };
    }

    private async addPendingTestItem(runId: string, test: TestItem): Promise<void> {
        await this.connection.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: mapTestItemToDb(runId, getTtl(this.ttl), test, StatusOffset.Pending),
            }),
        );
    }

    private async queryNextTest(runId: string, start: number, project?: string): Promise<TestItem | undefined> {
        if (project) {
            return this.queryNextTestByProjectWithPagination(runId, start, project);
        }

        const command: QueryCommandInput = {
            TableName: this.testsTableName,
            KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :start AND :end',
            ExpressionAttributeNames: { '#pk': Fields.Id, '#sk': Fields.Order },
            ExpressionAttributeValues: {
                ':pk': runId,
                ':start': 1 + start,
                ':end': start + OFFSET_STEP - 1,
            },
            Limit: 1,
        };
        const queryOutput = await this.connection.docClient.send(new QueryCommand(command));
        if (queryOutput.Count === 0) return;
        return mapDbToTestItem(queryOutput.Items![0] as TestItemDb);
    }

    private async queryNextTestByProjectWithPagination(
        runId: string,
        start: number,
        project: string,
    ): Promise<TestItem | undefined> {
        const command: QueryCommandInput = {
            TableName: this.testsTableName,
            KeyConditionExpression: '#pk = :pk AND #sk BETWEEN :start AND :end',
            ExpressionAttributeNames: {
                '#pk': Fields.Id,
                '#sk': Fields.Order,
                '#projects': Fields.Projects,
            },
            ExpressionAttributeValues: {
                ':pk': runId,
                ':start': 1 + start,
                ':end': start + OFFSET_STEP - 1,
                ':projects': [project],
            },
            FilterExpression: '#projects = :projects',
            Limit: 1,
        };

        let exclusiveStartKey: QueryCommandInput['ExclusiveStartKey'];
        do {
            const queryOutput = await this.connection.docClient.send(
                new QueryCommand({
                    ...command,
                    ExclusiveStartKey: exclusiveStartKey,
                }),
            );
            if ((queryOutput.Count ?? 0) > 0 && queryOutput.Items?.length) {
                return mapDbToTestItem(queryOutput.Items[0] as TestItemDb);
            }
            exclusiveStartKey = queryOutput.LastEvaluatedKey;
        } while (exclusiveStartKey);

        return;
    }

    private async tryToDeleteItem(runId: string, order: number): Promise<boolean> {
        try {
            await this.connection.docClient.send(
                new DeleteCommand({
                    TableName: this.testsTableName,
                    Key: { [Fields.Id]: runId, [Fields.Order]: order },
                    ConditionExpression: 'attribute_exists(#pk) AND attribute_exists(#sk)',
                    ExpressionAttributeNames: { '#pk': Fields.Id, '#sk': Fields.Order },
                }),
            );
            return true;
        } catch {
            return false;
        }
    }

    async getRemainingCounters(_config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }> {
        const run = await this.getTestRun(this.runContext.runId);
        const cfg = run[Fields.Config];
        return {
            remainingCount: Math.max(0, cfg?.remainingCount ?? 0),
            remainingTime: Math.max(0, cfg?.remainingTime ?? 0),
        };
    }
}
