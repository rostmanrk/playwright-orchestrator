import {
    TestItem,
    TestRunInfo,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    TestConfig,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args';
import { MongoClient, Db, Binary, Document } from 'mongodb';
import * as uuid from 'uuid';

const MAX_ORDER = 0b1111111111111111;

interface TestRunDocument extends Document {
    _id: Binary;
    status: RunStatus;
    config: TestConfig;
    args: string[];
    updated: Date;
}

interface TestDocument extends Document, Omit<TestItem, 'order' | 'position'> {
    _id: Binary;
    runId?: string;
    order?: number;
    line: number;
    column: number;
    status: TestStatus;
    updated: Date;
}

export class MongoDbAdapter extends Adapter {
    private readonly runsCollection: string;
    private readonly testsCollection: string;
    private readonly debug: boolean;
    private readonly db: Db;
    private readonly client: MongoClient;
    constructor(args: CreateArgs) {
        const { connectionString, collectionNamePrefix, db, tls, debug } = args;
        super();
        this.client = new MongoClient(connectionString, { tls });
        this.db = this.client.db(db);
        this.runsCollection = `${collectionNamePrefix}_test_runs`;
        this.testsCollection = `${collectionNamePrefix}_tests`;
        this.debug = debug ?? false;
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const result = await this.tests.findOneAndUpdate(
            {
                _id: {
                    $gte: this.generateTestId(runId, 0),
                    $lt: this.generateTestId(runId, MAX_ORDER),
                },
                status: { $in: [TestStatus.Ready] },
            },
            {
                $set: {
                    updated: new Date(),
                    status: TestStatus.Ongoing,
                },
            },
        );
        if (!result) return undefined;
        const { file, line, column, project, timeout } = result!;
        const { order } = this.parseTestId(result!._id);
        return {
            file,
            position: `${line}:${column}`,
            project,
            timeout,
            order,
        };
    }
    async finishTest(runId: string, test: TestItem): Promise<void> {
        await this.updateTestStatus(runId, test, TestStatus.Passed);
    }
    async failTest(runId: string, test: TestItem): Promise<void> {
        await this.updateTestStatus(runId, test, TestStatus.Failed);
    }

    private async updateTestStatus(runId: string, test: TestItem, status: TestStatus): Promise<void> {
        const { order } = test;
        const id = this.generateTestId(runId, order);
        await this.tests.updateOne(
            { _id: id },
            {
                $set: {
                    status,
                    updated: new Date(),
                },
            },
        );
    }

    async saveTestRun(runId: string, testRun: TestRunInfo, args: string[]): Promise<void> {
        const tests = this.flattenTestRun(testRun.testRun);

        const run = {
            _id: this.generateRunId(runId),
            status: RunStatus.Created,
            config: testRun.config,
            args,
            updated: new Date(),
        };

        await this.runs.insertOne(run);
        await this.tests.insertMany(
            tests.map(({ file, order, position, project, timeout }) => {
                const [line, column] = position.split(':').map(Number);
                return {
                    _id: this.generateTestId(runId, order),
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

    async initialize(): Promise<void> {
        const collections = await this.db.collections();
        if (!collections.some((c) => c.collectionName === this.runsCollection)) {
            await this.db.createCollection(this.runsCollection);
        }
        if (!collections.some((c) => c.collectionName === this.testsCollection)) {
            const collection = await this.db.createCollection(this.testsCollection);
            await collection.createIndex({ status: 1 });
        }
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const now = new Date();
        const run = await this.runs.findOneAndUpdate({ _id: this.generateRunId(runId) }, [
            {
                $set: {
                    status: {
                        $cond: {
                            if: { $in: ['$status', [RunStatus.Created]] },
                            then: RunStatus.Run,
                            else: RunStatus.RepeatRun,
                        },
                    },
                    updated: now,
                },
            },
        ]);
        if (!run) {
            throw new Error(`Run ${runId} not found`);
        }
        const { status: statusBefore } = run;
        if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
            await this.tests.updateMany(
                {
                    _id: {
                        $gte: this.generateTestId(runId, 0),
                        $lt: this.generateTestId(runId, MAX_ORDER),
                    },
                    status: TestStatus.Failed,
                },
                {
                    $set: {
                        status: TestStatus.Ready,
                        updated: now,
                    },
                },
            );
        }
        const { args, config, status, updated } = run;
        return { ...config, args, status, updated: updated.getTime() };
    }

    async finishShard(runId: string): Promise<void> {
        await this.runs.updateOne(
            { _id: uuid.parse(runId) },
            {
                $set: {
                    status: RunStatus.Finished,
                    updated: new Date(),
                },
            },
        );
    }

    async dispose(): Promise<void> {
        await this.client.close();
    }

    private get runs() {
        return this.db.collection<TestRunDocument>(this.runsCollection);
    }

    private get tests() {
        return this.db.collection<TestDocument>(this.testsCollection);
    }

    private generateTestId(runId: string, order: number) {
        const binaryRunId = uuid.parse(runId);
        const orderBytes = new Uint8Array(2);
        orderBytes[0] = (order >> 8) & 0xff;
        orderBytes[1] = order & 0xff;
        const combined = new Uint8Array([...binaryRunId, ...orderBytes]);
        return new Binary(combined, Binary.SUBTYPE_USER_DEFINED);
    }

    private generateRunId(runId: string) {
        return new Binary(uuid.parse(runId));
    }

    private parseTestId(testId: Binary): { runId: string; order: number } {
        const runId = uuid.stringify(testId.buffer.slice(0, 16));
        const order = (testId.buffer[16] << 8) + testId.buffer[17];
        return { runId, order };
    }
}
