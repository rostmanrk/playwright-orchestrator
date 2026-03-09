import { injectable, inject } from 'inversify';
import type { Initializer } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import {
    CreateTableCommand,
    DescribeTableCommand,
    UpdateTimeToLiveCommand,
} from '@aws-sdk/client-dynamodb';
import { Fields } from './constants.js';
import { DynamoDbConnection } from './dynamo-db-connection.js';
import { DYNAMO_CONFIG, DYNAMO_CONNECTION } from './symbols.js';

@injectable()
export class DynamoDbInitializer implements Initializer {
    constructor(
        @inject(DYNAMO_CONFIG) private readonly config: CreateArgs,
        @inject(DYNAMO_CONNECTION) private readonly connection: DynamoDbConnection,
    ) {}

    async initialize(): Promise<void> {
        const { tableNamePrefix } = this.config;
        const testsTableName = `${tableNamePrefix}-tests`;
        await this.createTestsTable(testsTableName);
        await this.enableTtl(testsTableName);
    }

    private async createTestsTable(tableName: string): Promise<void> {
        await this.connection.client.send(
            new CreateTableCommand({
                TableName: tableName,
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
            const res = await this.connection.client.send(new DescribeTableCommand({ TableName: tableName }));
            created = res.Table?.TableStatus === 'ACTIVE';
        } while (!created);
    }

    private async enableTtl(tableName: string): Promise<void> {
        await this.connection.client.send(
            new UpdateTimeToLiveCommand({
                TableName: tableName,
                TimeToLiveSpecification: { AttributeName: Fields.Ttl, Enabled: true },
            }),
        );
    }
}
