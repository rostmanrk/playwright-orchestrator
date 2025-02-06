import { TestResult } from '@playwright/test/reporter';
import { TestDetailsAnnotation } from '@playwright/test';
import { TestRunConfig, TestStatus } from './test-info.js';

export interface TestReport {
    file: string;
    position: string;
    project: string;
    status: TestStatus;
    duration: number;
    averageDuration: number;
    title: string;
    fails: number;
    lastSuccessfulRunTimestamp?: number;
}

export interface TestRunReport {
    runId: string;
    config: TestRunConfig;
    tests: TestReport[];
}

export interface BaseTestResult {
    annotations: TestDetailsAnnotation[];
    duration: number;
    title: string;
    status: TestResult['status'];
}

export interface TestReportResult extends BaseTestResult {
    error: TestResult['error'];
    tests: TestInfoResult[];
}

export interface TestInfoResult extends BaseTestResult {
    retry: number;
}
