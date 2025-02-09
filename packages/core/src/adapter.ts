import { ID_TYPE } from './playwright-tools/annotations.cjs';
import {
    TestItem,
    ResultTestParams,
    SaveTestRunParams,
    ReporterTestItem,
    TestSortItem,
    SortTestsOptions,
    GetTestIdParams,
} from './types/adapters.js';
import { TestRunReport } from './types/reporter.js';
import { TestRunConfig, TestRun } from './types/test-info.js';

export abstract class Adapter {
    abstract getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined>;
    abstract finishTest(params: ResultTestParams): Promise<void>;
    abstract failTest(params: ResultTestParams): Promise<void>;
    abstract saveTestRun(params: SaveTestRunParams): Promise<void>;
    abstract initialize(): Promise<void>;
    abstract startShard(runId: string): Promise<TestRunConfig>;
    abstract finishShard(runId: string): Promise<void>;
    abstract getReportData(runId: string): Promise<TestRunReport>;
    abstract dispose(): Promise<void>;

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
