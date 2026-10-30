import { inject, injectable } from 'inversify';
import type { TestItem, TestRunConfig, TestRunContext } from '../types/adapters.js';
import { Grouping } from '../types/adapters.js';
import { TestInfoResult, TestReportEvent } from '../types/reporter.js';
import { TestExecutionReporter } from './test-execution-reporter.js';
import type { Adapter } from '../adapters/adapter.js';
import { SYMBOLS } from '../symbols.js';
import { Project, TestStatus } from '../types/test-info.js';
import { getTestId } from '../helpers/get-test-id.js';

type HandlerResult = {
    onData: (data: any, isError: boolean) => void;
    /** Resolves to false when some tests exited without reporting a result. */
    onExit: (exitCode: number | null) => Promise<boolean>;
    batchResolver: Resolver;
};
type Resolver = { success: () => void; fail: (reason?: any) => void };

export interface TestEventHandler {
    init(tests: TestItem[], config: TestRunConfig, batchName: string): HandlerResult;
}

export type TestEventHandlerFactory = (tests: TestItem[], config: TestRunConfig, batchName: string) => HandlerResult;

@injectable()
export class PlaywrightTestEventHandler implements TestEventHandler {
    private readonly testResolvers: Map<string, Resolver> = new Map();
    private readonly childResolvers: Map<string, Resolver> = new Map();
    private readonly batchResolver: Resolver = { success: () => {}, fail: () => {} };
    private readonly testResults: Map<string, TestInfoResult[]> = new Map();
    private readonly childIdsByTest = new Map<string, Set<string>>();
    private tests: TestItem[] = [];
    private testMapping: Map<string, TestItem> = new Map();
    private expectedRunCounts: Map<string, number> = new Map();
    private projects: Map<string, Project> = new Map();
    private config!: TestRunConfig;
    private batchName!: string;

    constructor(
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
        @inject(SYMBOLS.Adapter) private readonly adapter: Adapter,
        @inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter,
    ) {}

    public init(tests: TestItem[], config: TestRunConfig, batchName: string) {
        this.config = config;
        this.initTests(tests, config, batchName);

        const onData = (data: any, isError: boolean) => {
            let event: TestReportEvent;
            if (isError) return;
            try {
                event = JSON.parse(data.toString()) as TestReportEvent;
            } catch {
                this.reporter.error(`Failed to parse test report event`);
                return;
            }
            const { type } = event;
            if (type === 'begin') {
                this.handleBegin(event);
            } else if (type === 'end') {
                this.handleEnd(event);
            }
        };

        // Results are only final once Playwright exits: a serial group reports its skipped tests as ok
        // and can still be retried, so status is decided and saved here rather than per event.
        const onExit = async (exitCode: number | null) => {
            let allReported = true;
            await Promise.all(
                this.tests.map(async (test) => {
                    const results = this.testResults.get(test.testId) ?? [];
                    const reportedRuns = new Set(results.map((result) => result.childId)).size;
                    let status: TestStatus;
                    if (reportedRuns < this.expectedRunCounts.get(test.testId)!) {
                        allReported = false;
                        this.failUnreportedTest(test, exitCode);
                        status = TestStatus.Failed;
                    } else {
                        status = this.computeStatus(results);
                    }
                    await this.saveTestResult(test, results, status);
                    const { success, fail } = this.testResolvers.get(test.testId)!;
                    if (status === TestStatus.Passed) {
                        success();
                    } else {
                        fail();
                    }
                }),
            );
            return allReported;
        };

        return { onData, onExit, batchResolver: this.batchResolver };
    }

    private extractChildData(event: TestReportEvent) {
        const {
            test: { testId, title, repeatEachIndex },
            result: { retry },
            project,
        } = event;
        let childId = this.config.options.grouping === Grouping.Test ? `[${project}] ${testId}` : testId;
        if (!childId.endsWith(title)) {
            childId += ` > ${title}`;
        }
        const projectConfig = this.projects.get(project);
        if ((projectConfig?.repeatEach ?? 1) > 1) {
            childId += ` (${repeatEachIndex + 1}/${projectConfig?.repeatEach})`;
        }
        let displayName = childId;
        if (retry > 0) {
            displayName += ` (retry: ${retry})`;
        }
        return { childId, displayName };
    }

    private handleBegin(event: TestReportEvent) {
        const {
            test: { testId: eventTestId },
        } = event;
        const test = this.testMapping.get(eventTestId);
        if (!test) {
            this.reporter.error(`Test with id ${eventTestId} not found.`);
            return;
        }
        const { childId, displayName } = this.extractChildData(event);
        if (!this.testResolvers.has(test.testId)) {
            this.reporter.addGroup(this.batchName, test, this.createTestPromise(test.testId));
        }
        if (!this.childIdsByTest.has(test.testId)) this.childIdsByTest.set(test.testId, new Set());
        this.childIdsByTest.get(test.testId)!.add(childId);
        if (!this.childResolvers.has(childId)) {
            this.reporter.addTest(test, childId, displayName, this.createChildPromise(childId));
        } else {
            this.reporter.updateTestDisplayName(test.testId, childId, displayName);
        }
    }

    private handleEnd(event: TestReportEvent) {
        const {
            test: { testId: eventTestId, ok, retries, repeatEachIndex },
            result: { duration, status, retry, error },
            project,
        } = event;
        const test = this.testMapping.get(eventTestId);
        if (!test) return;
        const { childId } = this.extractChildData(event);

        if (ok || retries === retry) {
            const childResolver = this.childResolvers.get(childId);
            if (childResolver) {
                ok ? childResolver.success() : childResolver.fail();
            }
        }
        if (!this.testResults.has(test.testId)) this.testResults.set(test.testId, []);
        this.testResults
            .get(test.testId)!
            .push({ duration, status, retry, error, ok, repeatEachIndex, project, childId });
    }

    /**
     * Playwright exited before reporting every result for the test (crash, killed worker, config error).
     * Failing it keeps it visible in reports and lets a repeat run pick it up again.
     */
    private failUnreportedTest(test: TestItem, exitCode: number | null) {
        this.reporter.error(
            `Test ${test.testId} did not report a result before Playwright exited with code ${exitCode}. Marking it as failed.`,
        );
        for (const childId of this.childIdsByTest.get(test.testId) ?? []) {
            this.childResolvers.get(childId)?.fail();
        }
    }

    /**
     * A test passes when, in every project, at least one repeat passed, and a repeat passes when the last
     * result of each of its child tests is ok. Looking at every child matters for serial groups: after a
     * failure Playwright reports the remaining children as skipped with ok() === true.
     */
    private computeStatus(results: TestInfoResult[]): TestStatus {
        const lastByRun = new Map<string, Map<number, Map<string, TestInfoResult>>>();
        for (const result of results) {
            if (!lastByRun.has(result.project)) lastByRun.set(result.project, new Map());
            const byRepeat = lastByRun.get(result.project)!;
            if (!byRepeat.has(result.repeatEachIndex)) byRepeat.set(result.repeatEachIndex, new Map());
            byRepeat.get(result.repeatEachIndex)!.set(result.childId, result);
        }
        const passed = [...lastByRun.values()].every((byRepeat) =>
            [...byRepeat.values()].some((lastByChild) => [...lastByChild.values()].every((result) => result.ok)),
        );
        return passed ? TestStatus.Passed : TestStatus.Failed;
    }

    private createBatchResolver() {
        return new Promise<void>((resolve, reject) => {
            this.batchResolver.success = resolve;
            this.batchResolver.fail = reject;
        });
    }

    private createTestPromise = (id: string) =>
        new Promise<void>((resolve, reject) => {
            this.testResolvers.set(id, { success: resolve, fail: reject });
        });

    private createChildPromise = (id: string) =>
        new Promise<void>((resolve, reject) => {
            this.childResolvers.set(id, { success: resolve, fail: reject });
        });

    private initTests(tests: TestItem[], config: TestRunConfig, batchName: string) {
        this.batchName = batchName;
        this.tests = tests;
        this.reporter.addBatch(batchName, this.createBatchResolver());
        for (const project of config.projects) {
            this.projects.set(project.name, project);
        }
        for (const test of tests) {
            this.testMapping.set(test.testId, test);
            for (const child of test.meta.children ?? []) {
                const baseTestIdParams = {
                    file: test.meta.file,
                    title: child,
                    annotations: test.meta.annotations,
                };
                if (config.options.grouping === Grouping.Test) {
                    this.testMapping.set(getTestId(baseTestIdParams), test);
                } else {
                    for (const project of test.meta.projects) {
                        this.testMapping.set(
                            getTestId({
                                ...baseTestIdParams,
                                project,
                            }),
                            test,
                        );
                    }
                }
            }
            for (const project of test.meta.projects) {
                const value = this.expectedRunCounts.get(test.testId) ?? 0;
                this.expectedRunCounts.set(
                    test.testId,
                    value + (test.meta.children?.length ?? 1) * this.projects.get(project)!.repeatEach,
                );
            }
            this.reporter.addGroup(batchName, test, this.createTestPromise(test.testId));
        }
    }

    private async saveTestResult(test: TestItem, results: TestInfoResult[], status: TestStatus) {
        await this.adapter.updateTestWithResults(status, {
            runId: this.runContext.runId,
            test,
            testResult: {
                // Summing durations of all retries and tests for the test to get total duration.
                // A test with no reported results falls back to its scheduled estimate so EMA isn't dragged to 0.
                duration: results.length > 0 ? results.reduce((acc, r) => acc + r.duration, 0) : test.ema,
                tests: results,
            },
            config: this.config,
        });
    }
}
