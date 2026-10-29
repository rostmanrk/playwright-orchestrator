import { BaseAdapter, TestRunReport, HistoryItem, SaveTestResultParams, TestRun } from '@playwright-orchestrator/core';
import { injectable, inject } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { readFile } from 'node:fs/promises';
import { withLock, writeFileAtomic } from './file-utils.js';
import { existsSync } from 'node:fs';
import { FILE_CONFIG } from './symbols.js';
import { getRunConfigPath, getHistoryRunPath, getResultsRunPath } from './file-paths.js';
import { ResultTestItem, TestHistoryItem } from './types.js';

@injectable()
export class FileAdapter extends BaseAdapter {
    private readonly dir: string;

    constructor(@inject(FILE_CONFIG) createArgs: CreateArgs) {
        super();
        this.dir = createArgs.directory;
    }

    async getReportData(runId: string): Promise<TestRunReport> {
        const configFile = getRunConfigPath(this.dir, runId);
        const resultsFile = getResultsRunPath(this.dir, runId);
        const { config, shards } = await withLock(
            configFile,
            async () => JSON.parse(await readFile(configFile, 'utf-8')) as TestRun,
        );
        const tests = await withLock(
            resultsFile,
            async () => JSON.parse(await readFile(resultsFile, 'utf-8')) as ResultTestItem[],
        );
        return {
            runId,
            config,
            shards,
            tests: tests.map(({ status, report, meta: { file, position, projects } }) => ({
                averageDuration: report.ema,
                duration: report.duration,
                fails: report.fails,
                title: report.title,
                file,
                position,
                projects,
                status,
                lastSuccessfulRunTimestamp: report.lastSuccessfulRunTimestamp,
            })),
        };
    }

    async getTestEma(testId: string): Promise<number> {
        const historyFile = getHistoryRunPath(this.dir);
        if (!existsSync(historyFile)) return 0;
        return withLock(historyFile, async () => {
            const history = JSON.parse(await readFile(historyFile, 'utf-8')) as Record<string, TestHistoryItem>;
            return history[testId]?.ema ?? 0;
        });
    }

    async saveTestResult({ runId, test, item, historyWindow, newEma }: SaveTestResultParams): Promise<void> {
        const historyFile = getHistoryRunPath(this.dir);
        const testItem = await withLock(historyFile, async () => {
            const history = JSON.parse(await readFile(historyFile, 'utf-8')) as Record<string, TestHistoryItem>;
            const testItem = history[test.testId];
            testItem.history.push({ duration: item.duration, status: item.status, updated: item.updated });
            if (testItem.history.length > historyWindow) {
                testItem.history.splice(0, testItem.history.length - historyWindow);
            }
            testItem.ema = newEma;
            await writeFileAtomic(historyFile, JSON.stringify(history, null, 2));
            return testItem;
        });
        const historyItems: HistoryItem[] = testItem.history.map((h) => ({
            status: h.status,
            duration: h.duration,
            updated: h.updated,
        }));
        const report = this.buildReport(test, item, newEma, historyItems);
        const resultsFile = getResultsRunPath(this.dir, runId);
        await withLock(resultsFile, async () => {
            const results = JSON.parse(await readFile(resultsFile, 'utf-8')) as ResultTestItem[];
            results.push({
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
            await writeFileAtomic(resultsFile, JSON.stringify(results, null, 2));
        });
    }
}
