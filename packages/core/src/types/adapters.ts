import { TestReportResult } from './reporter.js';
import { TestRunConfig, TestRunInfo } from './test-info.js';
import { TestDetailsAnnotation } from '@playwright/test';

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
