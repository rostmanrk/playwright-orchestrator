import type { TestReportResult } from './reporter.js';
import type { TestRunConfig, TestRunInfo, TestStatus } from './test-info.js';
import type { TestDetailsAnnotation } from '@playwright/test';

export interface TestItem {
    file: string;
    position: string;
    project: string;
    order: number;
    timeout: number;
}

export interface ReporterTestItem extends TestItem {
    testId: string;
}

export interface ResultTestParams {
    runId: string;
    test: TestItem;
    testResult: TestReportResult;
    config: TestRunConfig;
}

export interface SaveTestRunParams {
    runId: string;
    testRun: TestRunInfo;
    args: string[];
    historyWindow: number;
}

export interface GetTestIdParams {
    project: string;
    file: string;
    title: string;
    annotations: TestDetailsAnnotation[];
}

export interface SortTestsOptions {
    historyWindow: number;
    reverse?: boolean;
}

export interface TestSortItem {
    ema: number;
    fails: number;
}

export interface HistoryItem {
    status: TestStatus;
    duration: number;
    updated: number;
}

export interface SaveTestResultParams {
    runId: string;
    testId: string;
    test: TestItem;
    item: HistoryItem;
    historyWindow: number;
    newEma: number;
    title: string;
}
