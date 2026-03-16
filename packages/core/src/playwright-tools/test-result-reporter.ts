import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { TestCaseKeys, TestLocationKeys, TestReportEvent, TestResultKeys } from '../types/reporter.js';
import { getTestIdByTestCase } from '../helpers/get-test-id.js';

export default class TestResultReporter implements Reporter {
    onTestBegin(test: TestCase, result: TestResult): void {
        console.log(this.prepareTestResult('begin', test, result));
    }

    onTestEnd(test: TestCase, result: TestResult): void {
        console.log(this.prepareTestResult('end', test, result));
    }

    private prepareTestResult(type: TestReportEvent['type'], test: TestCase, result: TestResult): string {
        const [_, project, file] = test.titlePath();
        const event: TestReportEvent = {
            type,
            project,
            test: {
                ...this.pick(test, ...TestCaseKeys),
                location: this.pick(test.location, ...TestLocationKeys),
                ok: test.ok(),
                testId: getTestIdByTestCase(test),
            },
            result: this.pick(result, ...TestResultKeys),
        };
        return JSON.stringify(event);
    }

    private pick<T extends object, K extends keyof T>(obj: T, ...keys: K[]): Pick<T, K> {
        const result = {} as Pick<T, K>;
        for (const key of keys) {
            if (key in obj) {
                result[key] = obj[key];
            }
        }
        return result;
    }
}
