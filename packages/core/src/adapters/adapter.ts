import type { ResultTestParams } from '../types/adapters.js';
import type { TestRunReport } from '../types/reporter.js';

export interface Adapter {
    getReportData(runId: string): Promise<TestRunReport>;
    finishTest(params: ResultTestParams): Promise<void>;
    failTest(params: ResultTestParams): Promise<void>;
}
