import { injectable } from 'inversify';
import {
    TestItem,
    ResultTestParams,
    HistoryItem,
    SaveTestResultParams,
} from '../types/adapters.js';
import { TestReport, TestRunReport } from '../types/reporter.js';
import { TestStatus } from '../types/test-info.js';
import { getTestId } from '../helpers/get-test-id.js';
import type { Adapter } from './adapter.js';

@injectable()
export abstract class BaseAdapter implements Adapter {
    abstract getReportData(runId: string): Promise<TestRunReport>;

    abstract getTestEma(testId: string): Promise<number>;
    abstract saveTestResult(params: SaveTestResultParams): Promise<void>;

    async finishTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResults(TestStatus.Passed, params);
    }

    async failTest(params: ResultTestParams): Promise<void> {
        await this.updateTestWithResults(TestStatus.Failed, params);
    }

    protected async updateTestWithResults(
        status: TestStatus,
        { runId, test, testResult, config }: ResultTestParams,
    ): Promise<void> {
        const testId = getTestId({ ...test, ...testResult });
        const ema = await this.getTestEma(testId);
        const newEma = this.calculateEMA(testResult.duration, ema, config.historyWindow);
        await this.saveTestResult({
            runId,
            testId,
            test,
            item: { status, duration: testResult.duration, updated: Date.now() },
            historyWindow: config.historyWindow,
            newEma,
            title: testResult.title,
        });
    }

    protected buildReport(
        test: TestItem,
        item: HistoryItem,
        title: string,
        newEma: number,
        history: HistoryItem[],
    ): TestReport {
        return {
            file: test.file,
            position: test.position,
            project: test.project,
            status: item.status,
            duration: item.duration,
            averageDuration: newEma,
            title,
            fails: history.filter((h) => h.status === TestStatus.Failed).length,
            lastSuccessfulRunTimestamp: history.findLast((h) => h.status === TestStatus.Passed)?.updated,
        };
    }

    // Exponential Moving Average
    protected calculateEMA(current: number, ema: number, window: number): number {
        if (ema === 0) return current;
        const k = 2 / (window + 1);
        return current * k + ema * (1 - k);
    }
}
