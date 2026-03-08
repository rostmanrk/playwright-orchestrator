import {
    BaseAdapter,
    TestStatus,
    TestRunReport,
    HistoryItem,
    SaveTestResultParams,
} from '@playwright-orchestrator/core';
import { injectable, inject } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { MongoConnection } from './mongo-connection.js';
import { TestDocument, TestInfoDocument, TestRunDocument } from './types.js';
import { MONGO_CONFIG, MONGO_CONNECTION } from './symbols.js';
import { generateTestId, generateRunId, mapDbToTestRunConfig } from './helpers.js';

const MAX_ORDER = 0b1111111111111111;
@injectable()
export class MongoDbAdapter extends BaseAdapter {
    private readonly runsCollection: string;
    private readonly testsCollection: string;
    private readonly testsInfoCollection: string;
    private readonly connection: MongoConnection;

    constructor(
        @inject(MONGO_CONFIG) { collectionNamePrefix }: CreateArgs,
        @inject(MONGO_CONNECTION) connection: MongoConnection,
    ) {
        super();
        this.connection = connection;
        this.runsCollection = `${collectionNamePrefix}_test_runs`;
        this.testsCollection = `${collectionNamePrefix}_tests`;
        this.testsInfoCollection = `${collectionNamePrefix}_tests_info`;
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const run = await this.runs.findOne({ _id: generateRunId(runId) });
        if (!run) {
            throw new Error(`Run ${runId} not found`);
        }
        const config = mapDbToTestRunConfig(run);
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

    async getTestEma(testId: string): Promise<number> {
        const doc = await this.testInfo.findOne({ _id: testId });
        return doc?.ema ?? 0;
    }

    async saveTestResult({ runId, testId, test, item, historyWindow, newEma, title }: SaveTestResultParams): Promise<void> {
        const updatedDoc = await this.testInfo.findOneAndUpdate(
            { _id: testId },
            {
                $set: { ema: newEma },
                // @ts-ignore
                $push: {
                    history: {
                        $each: [{ duration: item.duration, status: item.status, updated: new Date(item.updated) }],
                        $slice: -historyWindow,
                    },
                },
            },
            { returnDocument: 'after' },
        );
        const history: HistoryItem[] = (updatedDoc?.history ?? []).map((h) => ({
            status: h.status,
            duration: h.duration,
            updated: h.updated instanceof Date ? h.updated.getTime() : (h.updated as number),
        }));
        const report = this.buildReport(test, item, title, newEma, history);
        const testDocId = generateTestId(runId, test.order);
        await this.tests.updateOne(
            { _id: testDocId },
            {
                $set: {
                    status: report.status,
                    updated: new Date(),
                    report: {
                        duration: report.duration,
                        title: report.title,
                        ema: report.averageDuration,
                        fails: report.fails,
                        lastSuccessfulRun: report.lastSuccessfulRunTimestamp
                            ? new Date(report.lastSuccessfulRunTimestamp)
                            : undefined,
                    },
                },
            },
        );
    }

    private get runs() {
        return this.connection.db.collection<TestRunDocument>(this.runsCollection);
    }

    private get tests() {
        return this.connection.db.collection<TestDocument>(this.testsCollection);
    }

    private get testInfo() {
        return this.connection.db.collection<TestInfoDocument>(this.testsInfoCollection);
    }

    private generateTestIdQuery(runId: string, ...statuses: TestStatus[]) {
        return {
            _id: {
                $gte: generateTestId(runId, 0),
                $lt: generateTestId(runId, MAX_ORDER),
            },
            status: { $in: statuses },
        };
    }
}
