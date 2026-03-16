import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { TestDetailsAnnotation } from '@playwright/test';
import type { TestRunConfig, TestStatus } from './test-info.js';

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

export type TestReportResultMap = Record<string, { case: TestCase; result: TestResult }[]>;

export const TestCaseKeys: readonly (keyof TestCase)[] = [
    'annotations',
    'repeatEachIndex',
    'title',
    'retries',
    'tags',
    'timeout',
] as const;
export const TestResultKeys: readonly (keyof TestResult)[] = ['status', 'error', 'duration', 'retry'] as const;
export const TestLocationKeys: readonly (keyof TestCase['location'])[] = ['line', 'column'] as const;

export interface TestReportEvent {
    type: 'begin' | 'end' | 'stepBegin';
    project: string;
    test: Omit<Pick<TestCase, (typeof TestCaseKeys)[number]>, 'ok'> & {
        location: Pick<TestCase['location'], (typeof TestLocationKeys)[number]>;
        testId: string;
        ok: boolean;
    };
    result: Pick<TestResult, (typeof TestResultKeys)[number]>;
}

export interface TestInfoResult extends BaseTestResult {
    retry: number;
}
