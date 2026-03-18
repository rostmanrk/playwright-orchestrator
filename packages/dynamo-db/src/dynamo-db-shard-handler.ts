import { injectable, inject } from 'inversify';
import type { ShardHandler } from '@playwright-orchestrator/core';
import { RunStatus } from '@playwright-orchestrator/core';
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
import { mapDbToTestItem, mapTestItemToDb, getTtl } from './helpers.js';
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
    ) {
        this.connection = connection;
        this.testsTableName = `${createArgs.tableNamePrefix}-tests`;
        this.ttl = createArgs.ttl * 24 * 60 * 60;
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const testRun = await this.getTestRun(runId);
        const status = testRun[Fields.Status] as RunStatus;
        const config = testRun[Fields.Config];
        if (status === RunStatus.Created || status === RunStatus.Finished) {
            const newStatus = status === RunStatus.Finished ? RunStatus.RepeatRun : RunStatus.Run;
            testRun[Fields.Status] = newStatus;
            await this.updateConfigStatus(runId, newStatus);
            await this.updateFailedTests(runId, config);
        }
        return config;
    }

    async finishShard(runId: string): Promise<void> {
        await this.updateConfigStatus(runId, RunStatus.Finished);
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
        return await this.getNextTestByStatus(runId, StatusOffset.Pending);
    }

    async getNextTestByProject(runId: string, project: string, config: TestRunConfig): Promise<TestItem | undefined> {
        return await this.getNextTestByStatus(runId, StatusOffset.Pending, project);
    }

    async getNextTestGroup(runId: string, config: TestRunConfig): Promise<TestItem[]> {
        throw new Error('Method not implemented.');
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
        await this.connection.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: mapTestItemToDb(runId, getTtl(this.ttl), test, StatusOffset.Pending),
            }),
        );
    }

    private async queryNextTest(runId: string, start: number, project?: string): Promise<TestItem | undefined> {
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
        if (project) {
            command.ExpressionAttributeNames!['#project'] = Fields.Project;
            command.ExpressionAttributeValues![':project'] = project;
            command.FilterExpression = command.FilterExpression ?? '' + '#project = :project';
        }
        const queryOutput = await this.connection.docClient.send(new QueryCommand(command));
        if (queryOutput.Count === 0) return;
        return mapDbToTestItem(queryOutput.Items![0] as TestItemDb);
    }

    private async updateConfigStatus(runId: string, status: RunStatus): Promise<void> {
        await this.connection.docClient.send(
            new UpdateCommand({
                TableName: this.testsTableName,
                Key: { [Fields.Id]: runId, [Fields.Order]: 0 },
                UpdateExpression: 'SET #cfg.#status = :status, #cfg.#updated = :updated',
                ExpressionAttributeNames: { '#cfg': Fields.Config, '#status': 'status', '#updated': 'updated' },
                ExpressionAttributeValues: { ':status': status, ':updated': Date.now() },
            }),
        );
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
        } catch (error) {
            return false;
        }
    }
}
