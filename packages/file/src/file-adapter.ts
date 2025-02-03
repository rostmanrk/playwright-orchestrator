import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestRunReport,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
    TestStatus,
} from '@playwright-orchestrator/core';
import { CreateArgs } from './create-args.js';
import { lock } from 'proper-lockfile';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';

interface ResultTestItem extends ReporterTestItem {
    status: TestStatus;
    report: {
        duration: number;
        ema: number;
        fails: number;
        title: string;
        lastSuccessfulRunTimestamp?: number;
    };
}

interface TestHistoryItem {
    ema: number;
    created: number;
    history: {
        duration: number;
        updated: number;
        status: TestStatus;
    }[];
}

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
            if (config.status === RunStatus.RepeatRun) {
                const results = JSON.parse(await readFile(this.getResultsRunPath(runId), 'utf-8')) as ResultTestItem[];
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
                await writeFile(this.getRunIdFilePath(runId), JSON.stringify(failed, null, 2));
                await writeFile(this.getResultsRunPath(runId), JSON.stringify(rest, null, 2), 'utf-8');
            }
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

    async failTest(params: ResultTestParams): Promise<void> {
        await this.addResult(TestStatus.Failed, params);
    }
    async finishTest(params: ResultTestParams): Promise<void> {
        await this.addResult(TestStatus.Passed, params);
    }

    async saveTestRun({ runId, testRun, args, historyWindow }: SaveTestRunParams): Promise<void> {
        const file = this.getRunConfigPath(runId);
        await mkdir(this.dir, { recursive: true });
        const testConfig: TestRunConfig = {
            ...testRun.config,
            args: args,
            status: 0,
            updated: Date.now(),
            historyWindow,
        };
        await writeFile(file, JSON.stringify(testConfig, null, 2));
        const tests = this.transformTestRunToItems(testRun.testRun, true);
        await writeFile(this.getRunIdFilePath(runId), JSON.stringify(tests, null, 2));
        await writeFile(this.getResultsRunPath(runId), '[]');
        await this.seedHistory(tests);
    }

    async initialize(): Promise<void> {
        return;
    }
    async dispose(): Promise<void> {}

    async getReportData(runId: string): Promise<TestRunReport> {
        const config = JSON.parse(await readFile(this.getRunConfigPath(runId), 'utf-8')) as TestRunConfig;
        const tests = JSON.parse(await readFile(this.getResultsRunPath(runId), 'utf-8')) as ResultTestItem[];
        return {
            runId,
            config,
            tests: tests.map(({ file, status, project, position, report }) => ({
                averageDuration: report.ema,
                duration: report.duration,
                fails: report.fails,
                title: report.title,
                file,
                position,
                project,
                status,
                lastSuccessfulRunTimestamp: report.lastSuccessfulRunTimestamp,
            })),
        };
    }

    private async seedHistory(test: ReporterTestItem[]) {
        const history: Record<string, TestHistoryItem> = !existsSync(this.getHistoryRunPath())
            ? {}
            : JSON.parse(await readFile(this.getHistoryRunPath(), 'utf-8'));
        for (const t of test) {
            if (!history[t.testId]) {
                history[t.testId] = {
                    ema: 0,
                    created: Date.now(),
                    history: [],
                };
            }
        }
        await writeFile(this.getHistoryRunPath(), JSON.stringify(history, null, 2));
    }

    private async addResult(status: TestStatus, params: ResultTestParams) {
        const { runId, test, testResult } = params;
        const file = this.getResultsRunPath(runId);
        const release = await lock(file, { retries: 100 });
        const results = JSON.parse(await readFile(file, 'utf-8')) as ResultTestItem[];
        const testId = this.getTestId({ ...test, ...testResult });
        const stats = await this.updateHistory(status, params);
        results.push({
            testId,
            ...test,
            status,
            report: {
                duration: testResult.duration,
                ema: stats.ema,
                fails: stats.history.filter((h) => h.status === TestStatus.Failed).length,
                title: testResult.title,
                lastSuccessfulRunTimestamp: stats.history.findLast((h) => h.status === TestStatus.Passed)?.updated,
            },
        });
        await writeFile(file, JSON.stringify(results, null, 2));
        await release();
    }

    private async updateHistory(status: TestStatus, { test, testResult, config }: ResultTestParams) {
        const file = this.getHistoryRunPath();
        const release = await lock(file, { retries: 100 });
        const history = JSON.parse(await readFile(file, 'utf-8')) as Record<string, TestHistoryItem>;
        const id = this.getTestId({ ...test, ...testResult });
        const item = history[id];
        const itemCopy = structuredClone(item);
        item.history.push({
            duration: testResult.duration,
            status,
            updated: Date.now(),
        });
        if (item.history.length > config.historyWindow) {
            item.history.splice(0, item.history.length - config.historyWindow);
        }
        item.ema = this.calculateEMA(testResult.duration, item.ema, config.historyWindow);
        await writeFile(file, JSON.stringify(history, null, 2));
        await release();
        return itemCopy;
    }

    private getRunIdFilePath(runId: string) {
        return `${this.dir}/${runId}.queue.json`;
    }

    private getRunConfigPath(runId: string) {
        return `${this.dir}/${runId}.config.json`;
    }

    private getHistoryRunPath() {
        return `${this.dir}/tests.history.json`;
    }

    private getResultsRunPath(runId: string) {
        return `${this.dir}/${runId}.results.json`;
    }
}
