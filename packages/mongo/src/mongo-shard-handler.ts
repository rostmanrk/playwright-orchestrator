import { injectable, inject } from 'inversify';
import type { ShardHandler } from '@playwright-orchestrator/core';
import { RunStatus, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { MongoConnection } from './mongo-connection.js';
import { MONGO_CONFIG, MONGO_CONNECTION } from './symbols.js';
import type { TestDocument, TestRunDocument } from './types.js';
import { generateTestId, generateRunId, parseTestId, mapDbToTestRunConfig } from './helpers.js';

const MAX_ORDER = 0b1111111111111111;

@injectable()
export class MongoShardHandler implements ShardHandler {
    private readonly runsCollection: string;
    private readonly testsCollection: string;
    private readonly connection: MongoConnection;

    constructor(
        @inject(MONGO_CONFIG) { collectionNamePrefix }: CreateArgs,
        @inject(MONGO_CONNECTION) connection: MongoConnection,
    ) {
        this.connection = connection;
        this.runsCollection = `${collectionNamePrefix}_test_runs`;
        this.testsCollection = `${collectionNamePrefix}_tests`;
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
        const result = await this.tests.findOneAndUpdate(this.generateTestIdQuery(runId, TestStatus.Ready), {
            $set: { updated: new Date(), status: TestStatus.Ongoing },
        });
        if (!result) return undefined;
        const { file, line, column, project, timeout } = result!;
        const { order } = parseTestId(result!._id);
        return { file, position: `${line}:${column}`, project, timeout, order };
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const now = new Date();
        const run = await this.runs.findOneAndUpdate({ _id: generateRunId(runId) }, [
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
        if (!run) throw new Error(`Run ${runId} not found`);
        const { status: statusBefore } = run;
        if (statusBefore === RunStatus.Created || statusBefore === RunStatus.Finished) {
            await this.tests.updateMany(this.generateTestIdQuery(runId, TestStatus.Failed), {
                $set: { status: TestStatus.Ready, updated: now },
            });
        }
        return mapDbToTestRunConfig(run);
    }

    async finishShard(runId: string): Promise<void> {
        await this.runs.updateOne(
            { _id: generateRunId(runId) },
            { $set: { status: RunStatus.Finished, updated: new Date() } },
        );
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
}
