import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRunContext } from '@playwright-orchestrator/core';
import { RunStatus, SYMBOLS, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MongoConnection } from './mongo-connection.js';
import { MONGO_CONFIG, MONGO_CONNECTION } from './symbols.js';
import type { TestDocument, TestRunDocument } from './types.js';
import { generateTestId, generateRunId, parseTestId } from './helpers.js';

const MAX_ORDER = 0b1111111111111111;

@injectable()
export class MongoShardHandler implements ShardHandler {
    private readonly runsCollection: string;
    private readonly testsCollection: string;
    private readonly connection: MongoConnection;

    constructor(
        @inject(MONGO_CONFIG) { collectionNamePrefix }: CreateArgs,
        @inject(MONGO_CONNECTION) connection: MongoConnection,
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
    ) {
        this.connection = connection;
        this.runsCollection = `${collectionNamePrefix}_test_runs`;
        this.testsCollection = `${collectionNamePrefix}_tests`;
    }

    async getNextTest(_config: TestRunConfig): Promise<TestItem | undefined> {
        return this.claimNextTest(this.runContext.runId);
    }

    async getNextTestByProject(project: string): Promise<TestItem | undefined> {
        return this.claimNextTest(this.runContext.runId, project);
    }

    private async claimNextTest(runId: string, project?: string): Promise<TestItem | undefined> {
        const query = project
            ? { ...this.generateTestIdQuery(runId, TestStatus.Ready), 'meta.projects': project }
            : this.generateTestIdQuery(runId, TestStatus.Ready);
        const result = await this.tests.findOneAndUpdate(query, {
            $set: { updated: new Date(), status: TestStatus.Ongoing },
        });
        if (!result) return undefined;
        const effectiveEma = result.ema;
        await this.runs.updateOne(
            { _id: generateRunId(runId) },
            { $inc: { 'config.remainingCount': -1, 'config.remainingTime': -effectiveEma } },
        );
        const { timeout, ema, testId, meta } = result;
        const { order } = parseTestId(result._id);
        return { timeout, ema, order, testId, meta };
    }

    async startShard(): Promise<TestRunConfig> {
        const { runId, shardId } = this.runContext;
        const now = new Date();
        const nowMs = now.getTime();
        const run = await this.runs.findOneAndUpdate({ _id: generateRunId(runId) }, [
            {
                $set: {
                    status: {
                        $cond: {
                            if: { $in: ['$status', [RunStatus.Created, RunStatus.Run]] },
                            then: RunStatus.Run,
                            else: RunStatus.RepeatRun,
                        },
                    },
                    [`shards.${shardId}`]: {
                        $ifNull: [`$shards.${shardId}`, { shardId, started: nowMs }],
                    },
                    updated: now,
                },
            },
        ]);
        if (!run) throw new Error(`Run ${runId} not found`);
        const { status: statusBefore } = run;
        if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
            await this.tests.updateMany(this.generateTestIdQuery(runId, TestStatus.Failed), {
                $set: { status: TestStatus.Ready, updated: now },
            });
            if (statusBefore === RunStatus.Finished) {
                const [agg] = await this.tests
                    .aggregate<{
                        count: number;
                        totalEma: number;
                    }>([
                        { $match: this.generateTestIdQuery(runId, TestStatus.Ready) },
                        { $group: { _id: null, count: { $sum: 1 }, totalEma: { $sum: '$ema' } } },
                    ])
                    .toArray();
                await this.runs.updateOne(
                    { _id: generateRunId(runId) },
                    { $set: { 'config.remainingCount': agg?.count ?? 0, 'config.remainingTime': agg?.totalEma ?? 0 } },
                );
            }
        }
        return run.config;
    }

    async finishShard(): Promise<void> {
        const { runId, shardId } = this.runContext;
        const now = new Date();
        const nowMs = now.getTime();
        await this.runs.updateOne({ _id: generateRunId(runId) }, [
            {
                $set: {
                    status: RunStatus.Finished,
                    updated: now,
                    [`shards.${shardId}.finished`]: {
                        $ifNull: [`$shards.${shardId}.finished`, nowMs],
                    },
                },
            },
        ]);
    }

    private get runs() {
        return this.connection.db.collection<TestRunDocument>(this.runsCollection);
    }

    private get tests() {
        return this.connection.db.collection<TestDocument>(this.testsCollection);
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

    async getRemainingCounters(_config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }> {
        const run = await this.runs.findOne(
            { _id: generateRunId(this.runContext.runId) },
            { projection: { 'config.remainingCount': 1, 'config.remainingTime': 1 } },
        );
        return {
            remainingCount: Math.max(0, (run?.config?.remainingCount as number) ?? 0),
            remainingTime: Math.max(0, (run?.config?.remainingTime as number) ?? 0),
        };
    }
}
