import {
    BaseAdapter,
    TestRunConfig,
    TestRunReport,
    ReporterTestItem,
    TestStatus,
    HistoryItem,
    SaveTestResultParams,
} from '@playwright-orchestrator/core';
import { injectable, inject } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { lock } from 'proper-lockfile';
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FILE_CONFIG } from './symbols.js';
import { getRunConfigPath, getHistoryRunPath, getResultsRunPath } from './file-paths.js';

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

@injectable()
export class FileAdapter extends BaseAdapter {
    private readonly dir: string;

    constructor(@inject(FILE_CONFIG) createArgs: CreateArgs) {
        super();
        this.dir = createArgs.directory;
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const config = JSON.parse(await readFile(getRunConfigPath(this.dir, runId), 'utf-8')) as TestRunConfig;
        const tests = JSON.parse(await readFile(getResultsRunPath(this.dir, runId), 'utf-8')) as ResultTestItem[];
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

    async getTestEma(testId: string): Promise<number> {
        const historyFile = getHistoryRunPath(this.dir);
        if (!existsSync(historyFile)) return 0;
        const history = JSON.parse(await readFile(historyFile, 'utf-8')) as Record<string, TestHistoryItem>;
        return history[testId]?.ema ?? 0;
    }

    async saveTestResult({
        runId,
        testId,
        test,
        item,
        historyWindow,
        newEma,
        title,
    }: SaveTestResultParams): Promise<void> {
        const historyFile = getHistoryRunPath(this.dir);
        let testItem: TestHistoryItem;
        const releaseHistory = await lock(historyFile, { retries: 100 });
        try {
            const history = JSON.parse(await readFile(historyFile, 'utf-8')) as Record<string, TestHistoryItem>;
            testItem = history[testId];
            testItem.history.push({ duration: item.duration, status: item.status, updated: item.updated });
            if (testItem.history.length > historyWindow) {
                testItem.history.splice(0, testItem.history.length - historyWindow);
            }
            testItem.ema = newEma;
            await writeFile(historyFile, JSON.stringify(history, null, 2));
        } finally {
            await releaseHistory();
        }
        const historyItems: HistoryItem[] = testItem.history.map((h) => ({
            status: h.status,
            duration: h.duration,
            updated: h.updated,
        }));
        const report = this.buildReport(test, item, title, newEma, historyItems);
        const resultsFile = getResultsRunPath(this.dir, runId);
        const releaseResults = await lock(resultsFile, { retries: 100 });
        try {
            const results = JSON.parse(await readFile(resultsFile, 'utf-8')) as ResultTestItem[];
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
            await writeFile(resultsFile, JSON.stringify(results, null, 2));
        } finally {
            await releaseResults();
        }
    }
}
