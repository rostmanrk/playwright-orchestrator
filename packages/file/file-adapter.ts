import { TestItem, TestRunInfo, Adapter, TestRun, TestRunConfig, RunStatus } from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args';
import { lock } from 'proper-lockfile';
import { readFile, writeFile, mkdir } from 'fs/promises';

export class FileAdapter extends Adapter {
    private readonly dir: string;

    constructor(createArgs: CreateArgs) {
        super();
        this.dir = createArgs.directory;
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const file = this.getRunConfigPath(runId);
        const release = await lock(file, { retries: 100 });
        const config = JSON.parse(await readFile(file, 'utf-8')) as TestRunConfig;
        if (config.status === RunStatus.Created || config.status === RunStatus.Finished) {
            config.status = config.status === RunStatus.Created ? RunStatus.Run : RunStatus.RepeatRun;
            config.updated = Date.now();
            await writeFile(file, JSON.stringify(config));
        }
        if (config.status === RunStatus.RepeatRun) {
            await writeFile(this.getRunIdFilePath(runId), await readFile(this.getFailedRunPath(runId), 'utf-8'));
        }
        await release();
        return config;
    }
    async finishShard(runId: string): Promise<void> {
        const file = this.getRunConfigPath(runId);
        const release = await lock(file, { retries: 100 });
        const config = JSON.parse(await readFile(file, 'utf-8')) as TestRunConfig;
        config.status = RunStatus.Finished;
        config.updated = Date.now();
        await writeFile(file, JSON.stringify(config));
        await release();
    }

    async getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined> {
        const file = this.getRunIdFilePath(runId);
        const release = await lock(file, { retries: 100 });
        const tests = JSON.parse(await readFile(file, 'utf-8')) as TestItem[];
        const test = tests.pop();
        await writeFile(file, JSON.stringify(tests, null, 2));
        await release();
        return test;
    }

    async finishTest(runId: string, test: TestItem): Promise<void> {}

    async failTest(runId: string, test: TestItem): Promise<void> {
        const file = this.getFailedRunPath(runId);
        const release = await lock(file, { retries: 100 });
        const failedTests = JSON.parse(await readFile(file, 'utf-8')) as TestItem[];
        failedTests.push(test);
        await writeFile(file, JSON.stringify(failedTests, null, 2));
        await release();
    }

    async saveTestRun(runId: string, testRun: TestRunInfo, args: string[]): Promise<void> {
        const file = this.getRunConfigPath(runId);
        await mkdir(this.dir, { recursive: true });
        const testConfig: TestRunConfig = {
            ...testRun.config,
            args: args,
            status: 0,
            updated: Date.now(),
        };
        await writeFile(file, JSON.stringify(testConfig, null, 2));
        await writeFile(
            this.getRunIdFilePath(runId),
            JSON.stringify(this.flattenTestRun(testRun.testRun, true), null, 2),
        );
        await writeFile(this.getFailedRunPath(runId), '[]');
    }

    async initialize(): Promise<void> {
        return;
    }
    async dispose(): Promise<void> {}

    private getRunIdFilePath(runId: string) {
        return `${this.dir}/${runId}.json`;
    }

    private getRunConfigPath(runId: string) {
        return `${this.dir}/${runId}.config.json`;
    }

    private getFailedRunPath(runId: string) {
        return `${this.dir}/${runId}.failed.json`;
    }
}
