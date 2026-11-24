import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRun, TestRunContext } from '@playwright-orchestrator/core';
import {
    everyOtherShardFinished,
    getClaimDeadline,
    RunStatus,
    SYMBOLS,
    TestStatus,
} from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { readFile } from 'node:fs/promises';
import { withLock, writeFileAtomic } from './file-utils.js';
import { FILE_CONFIG } from './symbols.js';
import { getRunIdFilePath, getRunConfigPath, getResultsRunPath, getClaimedRunPath } from './file-paths.js';
import { ClaimedTests, ResultTestItem } from './types.js';

@injectable()
export class FileShardHandler implements ShardHandler {
    private readonly dir: string;

    constructor(
        @inject(FILE_CONFIG) createArgs: CreateArgs,
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
    ) {
        this.dir = createArgs.directory;
    }

    async startShard(): Promise<TestRunConfig> {
        const { runId, shardId } = this.runContext;
        const file = getRunConfigPath(this.dir, runId);
        return withLock(file, async () => {
            const testRun = JSON.parse(await readFile(file, 'utf-8')) as TestRun;
            if (!testRun.shards[shardId]) {
                testRun.shards[shardId] = { shardId, started: Date.now() };
            }
            if (testRun.status === RunStatus.Created || testRun.status === RunStatus.Finished) {
                testRun.status = testRun.status === RunStatus.Created ? RunStatus.Run : RunStatus.RepeatRun;
                testRun.updated = Date.now();
                if (testRun.status === RunStatus.RepeatRun) {
                    const results = JSON.parse(
                        await readFile(getResultsRunPath(this.dir, runId), 'utf-8'),
                    ) as ResultTestItem[];
                    const failed: TestItem[] = results
                        .filter((r) => r.status === TestStatus.Failed)
                        .map(({ testId, order, timeout, ema, meta }) => ({
                            testId,
                            order,
                            timeout,
                            ema,
                            meta,
                        }));

                    const rest = results.filter((r) => r.status !== TestStatus.Failed);
                    const queueFile = getRunIdFilePath(this.dir, runId);
                    // Keep tests the previous run never claimed, e.g. after it was interrupted
                    const unclaimed = JSON.parse(await readFile(queueFile, 'utf-8')) as TestItem[];
                    // A claim is recorded before the queue is written, so a crash in between leaves the test in both
                    const queuedIds = new Set(unclaimed.map((test) => test.testId));
                    const abandoned = (await this.takeAbandonedTests(testRun)).filter(
                        (test) => !queuedIds.has(test.testId),
                    );
                    // Tests are popped from the end, so keep the queue sorted by descending order
                    const queue = [...unclaimed, ...failed, ...abandoned].sort((a, b) => b.order - a.order);
                    await writeFileAtomic(queueFile, JSON.stringify(queue, null, 2));
                    await writeFileAtomic(getResultsRunPath(this.dir, runId), JSON.stringify(rest, null, 2));
                    testRun.config.remainingCount = queue.length;
                    testRun.config.remainingTime = queue.reduce((sum, t) => sum + t.ema, 0);
                }
            }
            await writeFileAtomic(file, JSON.stringify(testRun));
            return testRun.config;
        });
    }

    /** Removes and returns the tests that were claimed but never got a result, e.g. because their shard was killed */
    private async takeAbandonedTests(testRun: TestRun): Promise<TestItem[]> {
        const { runId, shardId } = this.runContext;
        const claimedFile = getClaimedRunPath(this.dir, runId);
        const claimed = JSON.parse(await readFile(claimedFile, 'utf-8')) as ClaimedTests;
        const allClaimed = everyOtherShardFinished(testRun.shards, shardId);
        const now = Date.now();
        const abandoned: TestItem[] = [];
        for (const [testId, test] of Object.entries(claimed)) {
            if (!allClaimed && !(test.meta.deadline !== undefined && test.meta.deadline < now)) continue;
            abandoned.push(test);
            delete claimed[testId];
        }
        await writeFileAtomic(claimedFile, JSON.stringify(claimed, null, 2));
        return abandoned;
    }

    async finishShard(): Promise<void> {
        const { runId, shardId } = this.runContext;
        const file = getRunConfigPath(this.dir, runId);
        await withLock(file, async () => {
            const testRun = JSON.parse(await readFile(file, 'utf-8')) as TestRun;
            testRun.status = RunStatus.Finished;
            testRun.updated = Date.now();
            if (testRun.shards[shardId]) {
                testRun.shards[shardId].finished ??= Date.now();
            }
            await writeFileAtomic(file, JSON.stringify(testRun, null, 2));
        });
    }

    async getNextTest(_config: TestRunConfig): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return this.popNextTest(runId);
    }

    async getNextTestByProject(project: string): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return this.popNextTest(runId, project);
    }

    async setClaimDeadline(tests: TestItem[], deadline: number | null): Promise<void> {
        const { runId } = this.runContext;
        const claimedFile = getClaimedRunPath(this.dir, runId);
        await withLock(getRunIdFilePath(this.dir, runId), async () => {
            const claimed = JSON.parse(await readFile(claimedFile, 'utf-8')) as ClaimedTests;
            for (const test of tests) {
                // Skipped when the test already has a result
                const claim = claimed[test.testId];
                if (!claim) continue;
                if (deadline === null) delete claim.meta.deadline;
                else claim.meta.deadline = deadline;
            }
            await writeFileAtomic(claimedFile, JSON.stringify(claimed, null, 2));
        });
    }

    private async popNextTest(runId: string, project?: string): Promise<TestItem | undefined> {
        const file = getRunIdFilePath(this.dir, runId);
        return withLock(file, async () => {
            const tests = JSON.parse(await readFile(file, 'utf-8')) as TestItem[];
            const index = project ? tests.findLastIndex((t) => t.meta.projects.includes(project)) : tests.length - 1;
            if (index === -1) return undefined;
            const [test] = tests.splice(index, 1);
            // Recorded before the queue is written, so a crash in between can only leave a test in both
            const claimedFile = getClaimedRunPath(this.dir, runId);
            const claimed = JSON.parse(await readFile(claimedFile, 'utf-8')) as ClaimedTests;
            claimed[test.testId] = { ...test, meta: { ...test.meta, deadline: getClaimDeadline() } };
            await writeFileAtomic(claimedFile, JSON.stringify(claimed, null, 2));
            await writeFileAtomic(file, JSON.stringify(tests, null, 2));
            await this.decrementCounters(runId, test.ema);
            return test;
        });
    }

    private async decrementCounters(runId: string, ema: number): Promise<void> {
        const configFile = getRunConfigPath(this.dir, runId);
        await withLock(configFile, async () => {
            const testRun = JSON.parse(await readFile(configFile, 'utf-8')) as TestRun;
            testRun.config.remainingCount = (testRun.config.remainingCount ?? 1) - 1;
            testRun.config.remainingTime = (testRun.config.remainingTime ?? 0) - ema;
            await writeFileAtomic(configFile, JSON.stringify(testRun, null, 2));
        });
    }

    async getRemainingCounters(_config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }> {
        const configFile = getRunConfigPath(this.dir, this.runContext.runId);
        return withLock(configFile, async () => {
            const testRun = JSON.parse(await readFile(configFile, 'utf-8')) as TestRun;
            return {
                remainingCount: Math.max(0, testRun.config.remainingCount ?? 0),
                remainingTime: Math.max(0, testRun.config.remainingTime ?? 0),
            };
        });
    }
}
