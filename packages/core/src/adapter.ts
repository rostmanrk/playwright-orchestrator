import { ID_TYPE } from './playwright-tools/annotations.cjs';
import {
    TestItem,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
    TestSortItem,
    SortTestsOptions,
    GetTestIdParams,
    HistoryItem,
    SaveTestResultParams,
} from './types/adapters.js';
import { TestReport, TestRunReport } from './types/reporter.js';
import { TestRunConfig, TestRun, TestStatus } from './types/test-info.js';

export abstract class Adapter {
    abstract getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined>;
    abstract startShard(runId: string): Promise<TestRunConfig>;
    abstract finishShard(runId: string): Promise<void>;
    abstract initialize(): Promise<void>;
    abstract dispose(): Promise<void>;
    abstract getReportData(runId: string): Promise<TestRunReport>;

    // Storage primitives — implemented per adapter
    abstract loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>>;
    abstract saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void>;
    abstract getTestEma(testId: string): Promise<number>;
    abstract saveTestResult(params: SaveTestResultParams): Promise<void>;

    // Override to true for adapters that pop from the end of the queue (e.g. file)
    protected get reverseSortOrder(): boolean {
        return false;
    }

    async saveTestRun({ runId, args, historyWindow, testRun }: SaveTestRunParams): Promise<void> {
        let tests = this.transformTestRunToItems(testRun.testRun);
        const testInfos = await this.loadTestInfos(tests);
        tests = this.sortTests(tests, testInfos, { historyWindow, reverse: this.reverseSortOrder });
        await this.saveRunData(runId, { ...testRun.config, args, historyWindow }, tests);
    }

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
        const testId = this.getTestId({ ...test, ...testResult });
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

    protected transformTestRunToItems(run: TestRun): ReporterTestItem[] {
        const tests = Object.entries(run)
            .flatMap(([file, tests]) => {
                return Object.entries(tests).flatMap(([position, { timeout, projects, title, annotations }]) => {
                    return projects.flatMap((project) => {
                        const testId = this.getTestId({ project, file, title, annotations });
                        return { testId, file, position, project, timeout };
                    });
                });
            })
            .map((test, i) => ({ ...test, order: i + 1 }));

        this.validateTests(tests);
        return tests;
    }

    protected sortTests(
        tests: ReporterTestItem[],
        testInfoMap: Map<string, TestSortItem>,
        { historyWindow, reverse }: SortTestsOptions,
    ): ReporterTestItem[] {
        const extractValue = this.extractCompareValue.bind(this, testInfoMap, historyWindow);
        return tests
            .sort((a, b) => (extractValue(b) - extractValue(a)) * (reverse ? -1 : 1))
            .map((test, i) => ({ ...test, order: i + 1 }));
    }

    private extractCompareValue(
        testInfoMap: Map<string, TestSortItem>,
        historyWindow: number,
        test: ReporterTestItem,
    ): number {
        const testInfo = testInfoMap.get(test.testId);
        let value = test.timeout;
        if (testInfo && testInfo.ema) {
            value = testInfo.ema;
        }
        const fails = testInfo?.fails ?? 0;
        if (fails > 0) {
            value *= fails / historyWindow + 1;
        }
        return value;
    }

    protected validateTests(tests: ReporterTestItem[]): void {
        const existingIds = new Map<string, ReporterTestItem>();
        for (const test of tests) {
            if (existingIds.has(test.testId)) {
                const existing = existingIds.get(test.testId)!;
                throw new Error(
                    [
                        `Test ${existing.file}:${existing.position} has the same ID as ${test.file}:${test.position}.`,
                        'Please make sure that each test has a unique ID annotation.',
                        'If no ID annotation is provided, the `{file} > {title}` will be taken as ID.',
                        'Or file name in case test is serial at the top level.',
                    ].join('\n'),
                );
            }
            existingIds.set(test.testId, test);
        }
    }

    protected getTestId({ project, file, title, annotations }: GetTestIdParams): string {
        const idAnnotation = annotations.find((a) => a.type === ID_TYPE);
        if (idAnnotation) return `[${project}] ${idAnnotation.description!}`;
        if (file === title) return `[${project}] ${file}`;
        return `[${project}] ${file} > ${title}`;
    }

    // Exponential Moving Average
    protected calculateEMA(current: number, ema: number, window: number): number {
        if (ema === 0) return current;
        const k = 2 / (window + 1);
        return current * k + ema * (1 - k);
    }
}
