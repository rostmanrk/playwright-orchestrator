import { inject, injectable } from 'inversify';
import type { TestItem, TestRunConfig, TestRunContext } from '../types/adapters.js';
import { Grouping } from '../types/adapters.js';
import { TestInfoResult, TestReportEvent } from '../types/reporter.js';
import { TestExecutionReporter } from './test-execution-reporter.js';
import type { Adapter } from '../adapters/adapter.js';
import { SYMBOLS } from '../symbols.js';
import { Project, TestStatus } from '../types/test-info.js';

type HandlerResult = { onData: (data: any) => void; onExit: () => Promise<void>; batchResolver: Resolver };
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
    private readonly pending: Promise<void>[] = [];
    private testMapping: Map<string, TestItem> = new Map();
    private testCounts: Map<string, number> = new Map();
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

        const onData = (data: any) => {
            let event: TestReportEvent;
            try {
                event = JSON.parse(data.toString()) as TestReportEvent;
            } catch (error) {
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

        const onExit = () => Promise.all(this.pending).then(() => {});

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
        const test = this.testMapping.get(eventTestId)!;
        const { childId, displayName } = this.extractChildData(event);
        if (!this.testResolvers.has(test.testId)) {
            this.reporter.addGroup(this.batchName, test, this.createTestPromise(test.testId));
        }
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
        const test = this.testMapping.get(eventTestId)!;
        const { childId } = this.extractChildData(event);

        if (ok || retries === retry) {
            this.testCounts.set(test.testId, this.testCounts.get(test.testId)! - 1);
            const childResolver = this.childResolvers.get(childId);
            if (childResolver) {
                ok ? childResolver.success() : childResolver.fail();
            }
        }
        if (!this.testResults.has(test.testId)) this.testResults.set(test.testId, []);
        this.testResults.get(test.testId)!.push({ duration, status, retry, error, ok, repeatEachIndex, project });
        if ((this.testCounts.get(test.testId) ?? 0) === 0) {
            const { success, fail } = this.testResolvers.get(test.testId)!;
            this.pending.push(
                this.saveTestResult(test, this.testResults, this.config).then(() => {
                    ok ? success() : fail();
                }),
            );
        }
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
        this.reporter.addBatch(batchName, this.createBatchResolver());
        for (const project of config.projects) {
            this.projects.set(project.name, project);
        }
        for (const test of tests) {
            this.testMapping.set(test.testId, test);
            for (const childId of test.children ?? []) {
                this.testMapping.set(childId, test);
            }
            for (const project of test.projects) {
                const value = this.testCounts.get(test.testId) ?? 0;
                this.testCounts.set(
                    test.testId,
                    value + (test.children?.length ?? 1) * this.projects.get(project)!.repeatEach,
                );
            }
            this.reporter.addGroup(batchName, test, this.createTestPromise(test.testId));
        }
    }

    private async saveTestResult(test: TestItem, testResults: Map<string, TestInfoResult[]>, config: TestRunConfig) {
        const tests = testResults.get(test.testId)!;
        const grouped = tests.reduce((acc, r) => {
            if (!acc.has(r.project)) acc.set(r.project, new Map<number, TestInfoResult[]>());
            const byRepeat = acc.get(r.project)!;
            if (!byRepeat.has(r.repeatEachIndex)) byRepeat.set(r.repeatEachIndex, []);
            byRepeat.get(r.repeatEachIndex)!.push(r);
            return acc;
        }, new Map<string, Map<number, TestInfoResult[]>>());
        // Test is considered passed if test in every project passed.
        const status = [...grouped.values()].every((byRepeat) =>
            // A test is considered passed if at least one of the repeat runs for any project passed.
            [...byRepeat.values()].some((group) => group.at(-1)?.ok),
        )
            ? TestStatus.Passed
            : TestStatus.Failed;
        await this.adapter.updateTestWithResults(status, {
            runId: this.runContext.runId,
            test,
            testResult: {
                // Summing durations of all retries and tests for the test to get total duration.
                duration: tests.reduce((acc, r) => acc + r.duration, 0),
                tests,
            },
            config,
        });
    }
}
