import {
    TestItem,
    Adapter,
    TestRunConfig,
    RunStatus,
    TestRunReport,
    ReporterTestItem,
    TestStatus,
    TestSortItem,
    HistoryItem,
} from '@playwright-orchestrator/core';
import { TestReport } from '@playwright-orchestrator/core';
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

    protected override get reverseSortOrder(): boolean {
        return true;
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

    async loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>> {
        await mkdir(this.dir, { recursive: true });
        const history: Record<string, TestHistoryItem> = !existsSync(this.getHistoryRunPath())
            ? {}
            : JSON.parse(await readFile(this.getHistoryRunPath(), 'utf-8'));
        for (const t of tests) {
            if (!history[t.testId]) {
                history[t.testId] = {
                    ema: 0,
                    created: Date.now(),
                    history: [],
                };
            }
        }
        await writeFile(this.getHistoryRunPath(), JSON.stringify(history, null, 2));
        return new Map(
            Object.entries(history).map(([testId, { ema, history }]) => [
                testId,
                { ema, fails: history.filter((h) => h.status === TestStatus.Failed).length },
            ]),
        );
    }

    async saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void> {
        const testConfig: TestRunConfig = {
            ...(config as TestRunConfig),
            status: RunStatus.Created,
            updated: Date.now(),
        };
        await writeFile(this.getRunConfigPath(runId), JSON.stringify(testConfig, null, 2));
        await writeFile(this.getRunIdFilePath(runId), JSON.stringify(tests, null, 2));
        await writeFile(this.getResultsRunPath(runId), '[]');
    }

    async getTestEma(testId: string): Promise<number> {
        if (!existsSync(this.getHistoryRunPath())) return 0;
        const history = JSON.parse(await readFile(this.getHistoryRunPath(), 'utf-8')) as Record<string, TestHistoryItem>;
        return history[testId]?.ema ?? 0;
    }

    async saveTestHistory(
        testId: string,
        item: HistoryItem,
        historyWindow: number,
        newEma: number,
    ): Promise<HistoryItem[]> {
        const file = this.getHistoryRunPath();
        const release = await lock(file, { retries: 100 });
        const history = JSON.parse(await readFile(file, 'utf-8')) as Record<string, TestHistoryItem>;
        const testItem = history[testId];
        testItem.history.push({ duration: item.duration, status: item.status, updated: item.updated });
        if (testItem.history.length > historyWindow) {
            testItem.history.splice(0, testItem.history.length - historyWindow);
        }
        testItem.ema = newEma;
        await writeFile(file, JSON.stringify(history, null, 2));
        await release();
        return testItem.history.map((h) => ({ status: h.status, duration: h.duration, updated: h.updated }));
    }

    async saveTestRunReport(
        runId: string,
        testId: string,
        test: TestItem,
        report: TestReport,
        failed: boolean,
    ): Promise<void> {
        const file = this.getResultsRunPath(runId);
        const release = await lock(file, { retries: 100 });
        const results = JSON.parse(await readFile(file, 'utf-8')) as ResultTestItem[];
        results.push({
            testId,
            ...test,
            status: report.status,
            report: {
                duration: report.duration,
                ema: report.averageDuration,
                fails: report.fails,
                title: report.title,
                lastSuccessfulRunTimestamp: report.lastSuccessfulRunTimestamp,
            },
        });
        await writeFile(file, JSON.stringify(results, null, 2));
        await release();
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
