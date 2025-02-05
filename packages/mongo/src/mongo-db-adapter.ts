import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestStatus,
    TestRunReport,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
    TestSortItem,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { MongoClient, Db, Binary } from 'mongodb';
import * as uuid from 'uuid';
import { TestDocument, TestInfoDocument, TestRunDocument } from './types.js';

const MAX_ORDER = 0b1111111111111111;

export class MongoDbAdapter extends Adapter {
    private readonly runsCollection: string;
    private readonly testsCollection: string;
    private readonly testsInfoCollection: string;
    private readonly debug: boolean;
    private readonly db: Db;
    private readonly client: MongoClient;
    constructor(args: CreateArgs) {
        const {
            connectionString,
            collectionNamePrefix,
            db,
            tls,
            tlsCA,
            tlsKey,
            tlsPassphrase,
            tlsAllowInvalidCertificates,
            tlsAllowInvalidHostnames,
            tlsInsecure,
            tlsKeyPassword,
            debug,
        } = args;
        super();
        this.client = new MongoClient(connectionString, {
            tls,
            tlsCAFile: tlsCA,
            tlsCertificateKeyFile: tlsKey,
            tlsCertificateKeyFilePassword: tlsKeyPassword,
            passphrase: tlsPassphrase,
            tlsAllowInvalidCertificates,
            tlsAllowInvalidHostnames,
            tlsInsecure,
        });
        this.db = this.client.db(db);
        this.runsCollection = `${collectionNamePrefix}_test_runs`;
        this.testsCollection = `${collectionNamePrefix}_tests`;
        this.testsInfoCollection = `${collectionNamePrefix}_tests_info`;
        this.debug = debug ?? false;
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const result = await this.tests.findOneAndUpdate(this.generateTestIdQuery(runId, TestStatus.Ready), {
            $set: {
                updated: new Date(),
                status: TestStatus.Ongoing,
            },
        });
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
    async finishTest(params: ResultTestParams): Promise<void> {
        await this.updateTest(TestStatus.Passed, params);
    }
    async failTest(params: ResultTestParams): Promise<void> {
        await this.updateTest(TestStatus.Failed, params);
    }

    private async updateTest(status: TestStatus, { test, runId, testResult, config }: ResultTestParams): Promise<void> {
        const { order } = test;
        const { duration, title } = testResult;
        const testId = this.generateTestId(runId, order);
        const testInfoId = this.getTestId({ ...test, ...testResult });
        const testInfo = (await this.testInfo.findOne({ _id: testInfoId }))!;
        this.testInfo.updateOne(
            { _id: testInfoId },
            {
                $set: {
                    ema: this.calculateEMA(duration, testInfo.ema, config.historyWindow),
                },
                // @ts-ignore
                $push: {
                    history: {
                        $each: [
                            {
                                duration,
                                status,
                                updated: new Date(),
                            },
                        ],
                        $slice: -config.historyWindow,
                    },
                },
            },
        );

        await this.tests.updateOne(
            { _id: testId },
            {
                $set: {
                    status,
                    updated: new Date(),
                    report: {
                        duration: duration,
                        title: title,
                        ema: testInfo.ema,
                        fails: testInfo.history.filter((h) => h.status === TestStatus.Failed).length,
                        lastSuccessfulRun: testInfo.history.findLast((h) => h.status === TestStatus.Passed)?.updated,
                    },
                },
            },
        );
    }

    async saveTestRun({ testRun, runId, args, historyWindow }: SaveTestRunParams): Promise<void> {
        let tests = this.transformTestRunToItems(testRun.testRun);
        const testInfos = await this.loadTestInfo(tests);
        tests = this.sortTests(tests, testInfos, { historyWindow });
        const run = {
            _id: this.generateRunId(runId),
            status: RunStatus.Created,
            config: testRun.config,
            args,
            historyWindow,
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

    private async loadTestInfo(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
        const testInfoMap = new Map<string, TestSortItem>();
        for (const { testId } of tests) {
            if (!testInfoMap.has(testId)) {
                const item = await this.testInfo.findOneAndUpdate(
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

    async initialize(): Promise<void> {
        const collections = await this.db.collections();
        const set = new Set(collections.map((c) => c.collectionName));
        if (!set.has(this.runsCollection)) {
            await this.db.createCollection(this.runsCollection);
        }
        if (!set.has(this.testsCollection)) {
            const collection = await this.db.createCollection(this.testsCollection);
            await collection.createIndex({ status: 1 });
        }
        if (!set.has(this.testsInfoCollection)) {
            await this.db.createCollection(this.testsInfoCollection);
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
                this.generateTestIdQuery(runId, TestStatus.Failed),

                {
                    $set: {
                        status: TestStatus.Ready,
                        updated: now,
                    },
                },
            );
        }
        return this.mapDbToTestRunConfig(run);
    }

    private generateTestIdQuery(runId: string, ...statuses: TestStatus[]) {
        return {
            _id: {
                $gte: this.generateTestId(runId, 0),
                $lt: this.generateTestId(runId, MAX_ORDER),
            },
            status: { $in: statuses },
        };
    }

    private mapDbToTestRunConfig(run: TestRunDocument): TestRunConfig {
        const { args, config, status, updated, historyWindow } = run;
        return { ...config, args, historyWindow, status, updated: updated.getTime() };
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

    async getReportData(runId: string): Promise<TestRunReport> {
        const run = await this.runs.findOne({ _id: this.generateRunId(runId) });
        if (!run) {
            throw new Error(`Run ${runId} not found`);
        }
        const config = this.mapDbToTestRunConfig(run);
        const tests = await this.tests
            .find(this.generateTestIdQuery(runId, TestStatus.Failed, TestStatus.Passed))
            .toArray();
        return {
            runId,
            config,
            tests: tests.map(({ file, line, column, project, status, report }) => {
                const position = `${line}:${column}`;
                const { duration, fails, title, lastSuccessfulRun, ema } = report!;
                return {
                    file,
                    position,
                    project,
                    status,
                    title,
                    duration,
                    fails,
                    lastSuccessfulRunTimestamp: lastSuccessfulRun?.getTime(),
                    averageDuration: ema,
                };
            }),
        };
    }

    private get runs() {
        return this.db.collection<TestRunDocument>(this.runsCollection);
    }

    private get tests() {
        return this.db.collection<TestDocument>(this.testsCollection);
    }

    private get testInfo() {
        return this.db.collection<TestInfoDocument>(this.testsInfoCollection);
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
