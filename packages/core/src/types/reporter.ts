import type { TestCase, TestResult } from '@playwright/test/reporter';
import type { TestStatus } from './test-info.js';
import { TestRunConfig } from './adapters.js';

export interface TestReport {
    file: string;
    position: string;
    projects: string[];
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
    duration: number;
    status: TestResult['status'];
}

export interface TestReportResult extends BaseTestResult {
    tests: TestInfoResult[];
}

export interface TestInfoResult extends BaseTestResult {
    ok: boolean;
    error: TestResult['error'];
    retry: number;
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
