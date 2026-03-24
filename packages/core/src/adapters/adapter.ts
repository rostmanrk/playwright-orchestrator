import { TestStatus } from '../types/test-info.js';
import type { ResultTestParams } from '../types/adapters.js';
import type { TestRunReport } from '../types/reporter.js';

export interface Adapter {
    getReportData(runId: string): Promise<TestRunReport>;
    updateTestWithResults(status: TestStatus, resultParams: ResultTestParams): Promise<void>;
}
