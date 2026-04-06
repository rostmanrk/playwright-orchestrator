import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRun, TestRunContext, TestShard } from '@playwright-orchestrator/core';
import { RunStatus, SYMBOLS, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { lock } from 'proper-lockfile';
import { readFile, writeFile } from 'node:fs/promises';
import { FILE_CONFIG } from './symbols.js';
import { getRunIdFilePath, getRunConfigPath, getResultsRunPath } from './file-paths.js';
import { ResultTestItem } from './types.js';

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
        const release = await lock(file, { retries: 100 });
        try {
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
                        .map(({ file, testId, order, position, projects, timeout, children, ema }) => ({
                            file,
                            testId,
                            order,
                            position,
                            projects,
                            timeout,
                            children,
                            ema,
                        }));

                    const rest = results.filter((r) => r.status !== TestStatus.Failed);
                    await writeFile(getRunIdFilePath(this.dir, runId), JSON.stringify(failed, null, 2), 'utf-8');
                    await writeFile(getResultsRunPath(this.dir, runId), JSON.stringify(rest, null, 2), 'utf-8');
                }
            }
            await writeFile(file, JSON.stringify(testRun));
            return testRun.config;
        } finally {
            await release();
        }
    }

    async finishShard(): Promise<void> {
        const { runId, shardId } = this.runContext;
        const file = getRunConfigPath(this.dir, runId);
        const release = await lock(file, { retries: 100 });
        try {
            const testRun = JSON.parse(await readFile(file, 'utf-8')) as TestRun;
            testRun.status = RunStatus.Finished;
            testRun.updated = Date.now();
            if (testRun.shards[shardId]) {
                testRun.shards[shardId].finished ??= Date.now();
            }
            await writeFile(file, JSON.stringify(testRun, null, 2));
        } finally {
            await release();
        }
    }

    async getNextTest(_config: TestRunConfig): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return this.popNextTest(runId);
    }

    async getNextTestByProject(project: string): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        return this.popNextTest(runId, project);
    }

    private async popNextTest(runId: string, project?: string): Promise<TestItem | undefined> {
        const file = getRunIdFilePath(this.dir, runId);
        const release = await lock(file, { retries: 100 });
        try {
            const tests = JSON.parse(await readFile(file, 'utf-8')) as TestItem[];
            const index = project ? tests.findLastIndex((t) => t.projects.includes(project)) : tests.length - 1;
            if (index === -1) return undefined;
            const [test] = tests.splice(index, 1);
            await writeFile(file, JSON.stringify(tests, null, 2));
            return test;
        } finally {
            await release();
        }
    }
}
