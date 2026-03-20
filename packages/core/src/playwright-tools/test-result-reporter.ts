import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { TestCaseKeys, TestLocationKeys, TestReportEvent, TestResultKeys } from '../types/reporter.js';
import { getTestId } from '../helpers/get-test-id.js';
import { pick } from '../helpers/pick.js';
import { Grouping } from '../types/adapters.js';

export default class TestResultReporter implements Reporter {
    private readonly grouping = process.env.PLAYWRIGHT_ORCHESTRATOR_GROUPING;

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
                ...pick(test, ...TestCaseKeys),
                location: pick(test.location, ...TestLocationKeys),
                ok: test.ok(),
                testId: getTestId({
                    project: this.grouping === Grouping.Project ? project : undefined,
                    file,
                    title: test.title,
                    annotations: test.annotations,
                }),
            },
            result: pick(result, ...TestResultKeys),
        };
        return JSON.stringify(event);
    }
}
