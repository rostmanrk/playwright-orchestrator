import { injectable } from 'inversify';
import { getTestId } from '../helpers/get-test-id.js';
import type { TestRunCreator } from './test-run-creator.js';
import type { SaveTestRunParams, ReporterTestItem, TestSortItem, SortTestsOptions } from '../types/adapters.js';
import type { TestRun } from '../types/test-info.js';

@injectable()
export abstract class BaseTestRunCreator implements TestRunCreator {
    get reverseSortOrder(): boolean {
        return false;
    }

    abstract loadTestInfos(tests: ReporterTestItem[]): Promise<Map<string, TestSortItem>>;
    abstract saveRunData(runId: string, config: object, tests: ReporterTestItem[]): Promise<void>;

    async create({ runId, testRun, args, historyWindow }: SaveTestRunParams): Promise<void> {
        let tests = this.transformTestRunToItems(testRun.testRun);
        const testInfos = await this.loadTestInfos(tests);
        tests = this.sortTests(tests, testInfos, { historyWindow, reverse: this.reverseSortOrder });
        await this.saveRunData(runId, { ...testRun.config, args, historyWindow }, tests);
    }

    private transformTestRunToItems(run: TestRun): ReporterTestItem[] {
        const tests = Object.entries(run)
            .flatMap(([file, tests]) =>
                Object.entries(tests).flatMap(([position, { timeout, projects, title, annotations }]) =>
                    projects.flatMap((project) => {
                        const testId = getTestId({ project, file, title, annotations });
                        return { testId, file, position, project, timeout };
                    }),
                ),
            )
            .map((test, i) => ({ ...test, order: i + 1 }));
        this.validateTests(tests);
        return tests;
    }

    private sortTests(
        tests: ReporterTestItem[],
        testInfoMap: Map<string, TestSortItem>,
        { historyWindow, reverse }: SortTestsOptions,
    ): ReporterTestItem[] {
        const extractValue = this.extractCompareValue.bind(this, testInfoMap, historyWindow);
        return tests
            .sort((a, b) => (extractValue(b) - extractValue(a)) * (reverse ? -1 : 1))
            .map((test, i) => ({ ...test, order: reverse ? tests.length - i : i + 1 }));
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

    private validateTests(tests: ReporterTestItem[]): void {
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
}
