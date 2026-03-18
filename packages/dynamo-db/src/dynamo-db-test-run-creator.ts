import { injectable, inject, injectFromBase } from 'inversify';
import { BaseTestRunCreator } from '@playwright-orchestrator/core';
import type { TestItem, TestRun, TestSortItem } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { PutCommand, BatchWriteCommand, BatchGetCommand } from '@aws-sdk/lib-dynamodb';
import { mapDbTestInfoToSortItem, mapTestItemToDb, getTtl, mapTestRunToDb } from './helpers.js';
import { Fields } from './constants.js';
import type { TestInfoItem } from './types.js';
import { DynamoDbConnection } from './dynamo-db-connection.js';
import { DYNAMO_CONFIG, DYNAMO_CONNECTION } from './symbols.js';

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
export class DynamoDbTestRunCreator extends BaseTestRunCreator {
    private readonly testsTableName: string;
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

    async loadTestInfos(tests: TestItem[]): Promise<Map<string, TestSortItem>> {
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

    async saveRunData(runId: string, testRun: TestRun, tests: TestItem[]): Promise<void> {
        await this.connection.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: mapTestRunToDb(runId, getTtl(this.ttl), testRun),
            }),
        );
        for (let i = 0; i < tests.length; i += 25) {
            await this.saveTestsBatch(runId, tests.slice(i, i + 25));
        }
    }

    private async saveTestsBatch(runId: string, tests: TestItem[]): Promise<void> {
        await this.connection.docClient.send(
            new BatchWriteCommand({
                RequestItems: {
                    [this.testsTableName]: tests.map((test) => ({
                        PutRequest: { Item: mapTestItemToDb(runId, getTtl(this.ttl), test) },
                    })),
                },
            }),
        );
    }

    private async queryTestInfo(tests: TestItem[]): Promise<TestInfoItem[]> {
        const testInfos: TestInfoItem[] = [];
        for (let i = 0; i < tests.length; i += 100) {
            const { Responses } = await this.connection.docClient.send(
                new BatchGetCommand({
                    RequestItems: {
                        [this.testsTableName]: {
                            Keys: tests.slice(i, i + 100).map((test) => ({
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
            [Fields.Ttl]: getTtl(this.ttl),
            [Fields.Version]: 1,
        };
        await this.connection.docClient.send(
            new PutCommand({
                TableName: this.testsTableName,
                Item: item,
            }),
        );
        return item;
    }
}
