import { FullConfig, FullResult, Reporter, Suite, TestCase, TestResult } from '@playwright/test/reporter';
import * as path from 'path';
const STATUS_MAP = {
    passed: 'o',
    failed: 'x',
    timedOut: 't',
    skipped: 's',
    interrupted: 'i',
};

export default class ConsistentTestReporter implements Reporter {
    private readonly tests: Record<
        string,
        {
            project: string;
            location: string;
            status: string;
            title: string;
        }
    > = {};
    private projectPadLength = 0;
    private testLocationPadLength = 0;
    onBegin(config: FullConfig, suite: Suite) {
        for (const test of suite.allTests()) {
            this.tests[test.id] = {
                project: `[${test.parent.project()?.name!}]`,
                location: this.getTestPosition(test),
                status: '?',
                title: test.title,
            };
            this.testLocationPadLength = Math.max(this.testLocationPadLength, this.tests[test.id].location.length);
            this.projectPadLength = Math.max(this.projectPadLength, this.tests[test.id].project.length);
        }
    }

    onTestEnd(test: TestCase, result: TestResult) {
        this.tests[test.id].status = STATUS_MAP[result.status];
    }

    onEnd(result: FullResult) {
        const tests = Object.values(this.tests).sort((a, b) => a.location.localeCompare(b.location));
        const padStartLen = tests.length.toString().length;
        for (let i = 0; i < tests.length; i++) {
            const { location, project, status, title } = tests[i];
            const num = (i + 1).toString().padStart(padStartLen);
            console.log(
                `${num}  ${status}  ${project.padEnd(this.projectPadLength)}  ${location.padEnd(this.testLocationPadLength)}  ${title}`,
            );
        }
    }

    private getTestPosition(test: TestCase) {
        const {
            location: { column, file, line },
        } = test;
        return `${path.basename(file)}:${line}:${column}`;
    }
}
