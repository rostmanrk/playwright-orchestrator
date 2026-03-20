import { inject, injectable } from 'inversify';
import { getTestId } from '../helpers/get-test-id.js';
import type { TestRunCreator } from './test-run-creator.js';
import type {
    SaveTestRunParams,
    TestItem,
    TestSortItem,
    SortTestsOptions,
    BaseOptions,
    TestRun,
} from '../types/adapters.js';
import type { ReporterTestRun } from '../types/test-info.js';
import { RunStatus, SYMBOLS } from '../index.js';
import type { RunInfoLoader } from '../index.js';
import { cliVersion } from '../commands/version.js';

@injectable()
export abstract class BaseTestRunCreator implements TestRunCreator {
    @inject(SYMBOLS.RunInfoLoader)
    private readonly runInfoLoader!: RunInfoLoader;

    get reverseSortOrder(): boolean {
        return false;
    }

    abstract loadTestInfos(tests: TestItem[]): Promise<Map<string, TestSortItem>>;
    abstract saveRunData(runId: string, testRun: TestRun, tests: TestItem[]): Promise<void>;

    async create({ runId, args, options }: SaveTestRunParams): Promise<void> {
        const reporterTestRun = await this.runInfoLoader.load(args);
        let tests = this.transformTestRunToItems(reporterTestRun.testRun, options);
        const testInfos = await this.loadTestInfos(tests);
        tests = this.sortTests(tests, testInfos, {
            historyWindow: options.historyWindow,
            reverse: this.reverseSortOrder,
        });
        const config: TestRun = {
            status: RunStatus.Created,
            updated: Date.now(),
            config: { ...reporterTestRun.config, options, args: this.cleanArgs(args), version: cliVersion },
        };
        await this.saveRunData(runId, config, tests);
    }

    private cleanArgs(args: string[]): string[] {
        let i = 0;
        while (i < args.length && !args[i].startsWith('--')) {
            i++;
        }
        return args.slice(i);
    }
    private transformTestRunToItems(run: ReporterTestRun, options: BaseOptions): TestItem[] {
        const tests = Object.entries(run)
            .flatMap(([file, tests]) =>
                Object.entries(tests).flatMap(([position, { timeout, projects, title, annotations, children }]) => {
                    const baseItem = { file, position, timeout };
                    if (options.grouping === 'test') {
                        return {
                            ...baseItem,
                            testId: getTestId({ file, title, annotations }),
                            projects,
                            children: children?.map((child) => getTestId({ file, title: child, annotations })),
                        };
                    }
                    return projects.flatMap((project) => ({
                        ...baseItem,
                        testId: getTestId({ project, file, title, annotations }),
                        projects: [project],
                        children: children?.map((child) => getTestId({ project, file, title: child, annotations })),
                    }));
                }),
            )
            .map((test) => ({ ...test, order: 0, ema: 0 }));
        this.validateTests(tests);
        return tests;
    }

    private sortTests(
        tests: TestItem[],
        testInfoMap: Map<string, TestSortItem>,
        { historyWindow, reverse }: SortTestsOptions,
    ): TestItem[] {
        const extractValue = this.extractCompareValue.bind(this, testInfoMap, historyWindow);
        return tests
            .map((test) => ({ ...test, ema: extractValue(test) } as TestItem))
            .sort((a, b) => (b.ema - a.ema) * (reverse ? -1 : 1))
            .map((test, i) => ({ ...test, order: reverse ? tests.length - i : i + 1 }));
    }

    private extractCompareValue(testInfoMap: Map<string, TestSortItem>, historyWindow: number, test: TestItem): number {
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

    private validateTests(tests: TestItem[]): void {
        const existingIds = new Map<string, TestItem>();
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
