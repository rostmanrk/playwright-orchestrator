import { injectable, inject } from 'inversify';
import type { ShardHandler } from '@playwright-orchestrator/core';
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
        const config = JSON.parse(await readFile(file, 'utf-8')) as TestRunConfig;
        if (config.status === RunStatus.Created || config.status === RunStatus.Finished) {
            config.status = config.status === RunStatus.Created ? RunStatus.Run : RunStatus.RepeatRun;
            config.updated = Date.now();
            await writeFile(file, JSON.stringify(config));
            if (config.status === RunStatus.RepeatRun) {
                const results = JSON.parse(await readFile(getResultsRunPath(this.dir, runId), 'utf-8')) as ResultTestItem[];
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
        await release();
        return config;
    }

    async finishShard(runId: string): Promise<void> {
        const file = getRunConfigPath(this.dir, runId);
        const release = await lock(file, { retries: 100 });
        const config = JSON.parse(await readFile(file, 'utf-8')) as TestRunConfig;
        config.status = RunStatus.Finished;
        config.updated = Date.now();
        await writeFile(file, JSON.stringify(config));
        await release();
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
        const file = getRunIdFilePath(this.dir, runId);
        const release = await lock(file, { retries: 100 });
        const tests = JSON.parse(await readFile(file, 'utf-8')) as TestItem[];
        const test = tests.pop();
        await writeFile(file, JSON.stringify(tests, null, 2));
        await release();
        return test;
    }

}
