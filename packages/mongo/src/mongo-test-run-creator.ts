import { injectable, inject } from 'inversify';
import { BaseTestRunCreator, RunStatus, TestStatus } from '@playwright-orchestrator/core';
import type { ReporterTestItem, TestSortItem } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MongoConnection } from './mongo-connection.js';
import type { TestInfoDocument } from './types.js';
import { MONGO_CONFIG, MONGO_CONNECTION } from './symbols.js';
import { generateRunId, generateTestId } from './helpers.js';

@injectable()
export class MongoTestRunCreator extends BaseTestRunCreator {
    private readonly runsCollection: string;
    private readonly testsCollection: string;
    private readonly testsInfoCollection: string;
    private readonly debug: boolean;
    private readonly connection: MongoConnection;

    constructor(@inject(MONGO_CONFIG) args: CreateArgs, @inject(MONGO_CONNECTION) connection: MongoConnection) {
        super();
        this.connection = connection;
        this.runsCollection = `${args.collectionNamePrefix}_test_runs`;
        this.testsCollection = `${args.collectionNamePrefix}_tests`;
        this.testsInfoCollection = `${args.collectionNamePrefix}_tests_info`;
        this.debug = args.debug ?? false;
    }

    async loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
        const testInfo = this.connection.db.collection<TestInfoDocument>(this.testsInfoCollection);
        const testInfoMap = new Map<string, TestSortItem>();
        for (const { testId } of tests) {
            if (!testInfoMap.has(testId)) {
                const item = await testInfo.findOneAndUpdate(
                    { _id: testId },
                    {
                        $setOnInsert: {
                            _id: testId,
                            create: new Date(),
                            ema: 0,
                            history: [],
                        },
                    },
                    { upsert: true, returnDocument: 'after' },
                );
                testInfoMap.set(testId, {
                    ema: item!.ema,
                    fails: item!.history.filter((h) => h.status === TestStatus.Failed).length,
                });
            }
        }
        return testInfoMap;
    }

    async saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void> {
        const { args, historyWindow, ...testRunConfig } = config as any;
        const run = {
            _id: generateRunId(runId),
            status: RunStatus.Created,
            config: testRunConfig,
            args,
            historyWindow,
            updated: new Date(),
        };
        await this.connection.db.collection(this.runsCollection).insertOne(run as any);
        if (tests.length === 0) return;
        await (this.connection.db.collection(this.testsCollection) as any).insertMany(
            tests.map(({ file, order, position, project, timeout }) => {
                const [line, column] = position.split(':').map(Number);
                return {
                    _id: generateTestId(runId, order),
                    file,
                    project,
                    timeout,
                    line,
                    column,
                    status: TestStatus.Ready,
                    updated: new Date(),
                    ...(this.debug ? { runId, order } : {}),
                };
            }),
        );
    }
}
