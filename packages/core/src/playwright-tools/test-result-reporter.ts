import { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import { TestReportResult } from '../types/reporter.js';

export default class TestResultReporter implements Reporter {
    private testResults: TestResult[] = [];
    private testCases: TestCase[] = [];
    private commonParent: Suite | undefined;

    onBegin(config: FullConfig, suite: Suite): void {
        const tests = suite.allTests();
        if (tests.length > 1) {
            const path = [];
            let current: Suite | undefined = tests[0].parent;
            while (current) {
                path.push(current);
                current = current.parent;
            }
            let lastCommonParent = path.length - 1;
            for (const test of tests.slice(1)) {
                current = test.parent;
                while (test.parent !== this.commonParent) {
                    const index = path.indexOf(current!);
                    if (index !== -1 && index < lastCommonParent) {
                        lastCommonParent = index;
                        break;
                    }
                    current = current?.parent;
                }
            }
            this.commonParent = path[lastCommonParent];
        }
    }

    onTestEnd(test: TestCase, result: TestResult): void {
        this.testResults.push(result);
        this.testCases.push(test);
    }
    onEnd(result: FullResult): Promise<{ status?: FullResult['status'] } | undefined | void> | void {
        const { status, error, retry } = this.testResults.at(-1)!;
        const duration = this.testResults.reduce((acc, { duration }) => acc + duration, 0);
        const existingAnnotations = new Set<string>();
        const annotations = this.testCases
            .flatMap((test) => test.annotations)
            .filter(({ type, description }) => {
                if (existingAnnotations.has(type + (description ?? ''))) return false;
                existingAnnotations.add(type + (description ?? ''));
                return true;
            });
        const { title } = this.commonParent ?? this.testCases.at(-1)!;
        const output: TestReportResult = {
            status,
            duration,
            error,
            title,
            annotations,
            tests: this.testResults.map(({ status, duration, error }, i) => ({
                status,
                duration,
                error,
                annotations: this.testCases[i].annotations,
                title: this.testCases[i].title,
                retry,
            })),
        };
        console.log(JSON.stringify(output));
    }
}
