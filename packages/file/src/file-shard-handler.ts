import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRun } from '@playwright-orchestrator/core';
import { RunStatus, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { lock } from 'proper-lockfile';
import { readFile, writeFile } from 'node:fs/promises';
import { FILE_CONFIG } from './symbols.js';
import { getRunIdFilePath, getRunConfigPath, getResultsRunPath } from './file-paths.js';

interface ResultTestItem {
    file: string;
    testId: string;
    order: number;
    position: string;
    project: string;
    timeout: number;
    status: TestStatus;
    report: any;
}

@injectable()
export class FileShardHandler implements ShardHandler {
    private readonly dir: string;

    constructor(@inject(FILE_CONFIG) createArgs: CreateArgs) {
        this.dir = createArgs.directory;
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const file = getRunConfigPath(this.dir, runId);
        const release = await lock(file, { retries: 100 });
        try {
            const testRun = JSON.parse(await readFile(file, 'utf-8')) as TestRun;
            if (testRun.status === RunStatus.Created || testRun.status === RunStatus.Finished) {
                testRun.status = testRun.status === RunStatus.Created ? RunStatus.Run : RunStatus.RepeatRun;
                testRun.updated = Date.now();
                await writeFile(file, JSON.stringify(testRun));
                if (testRun.status === RunStatus.RepeatRun) {
                    const results = JSON.parse(
                        await readFile(getResultsRunPath(this.dir, runId), 'utf-8'),
                    ) as ResultTestItem[];
                    const failed = results
                        .filter((r) => r.status === TestStatus.Failed)
                        .map(({ file, testId, order, position, project, timeout }) => ({
                            file,
                            testId,
                            order,
                            position,
                            project,
                            timeout,
                        }));
                    const rest = results.filter((r) => r.status !== TestStatus.Failed);
                    await writeFile(getRunIdFilePath(this.dir, runId), JSON.stringify(failed, null, 2));
                    await writeFile(getResultsRunPath(this.dir, runId), JSON.stringify(rest, null, 2), 'utf-8');
                }
            }
            return testRun.config;
        } finally {
            await release();
        }
    }

    async finishShard(runId: string): Promise<void> {
        const file = getRunConfigPath(this.dir, runId);
        const release = await lock(file, { retries: 100 });
        try {
            const testRun = JSON.parse(await readFile(file, 'utf-8')) as TestRun;
            testRun.status = RunStatus.Finished;
            testRun.updated = Date.now();
            await writeFile(file, JSON.stringify(testRun, null, 2));
        } finally {
            await release();
        }
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
        return this.popNextTest(runId);
    }

    async getNextTestByProject(runId: string, project: string): Promise<TestItem | undefined> {
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
