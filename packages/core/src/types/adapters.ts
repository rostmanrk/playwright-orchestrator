import type { TestReportResult } from './reporter.js';
import type { TestRunConfig, TestRunInfo, TestStatus } from './test-info.js';
import type { TestDetailsAnnotation } from '@playwright/test';

export const BatchMode = {
    Off: 'off',
    Time: 'time',
    Count: 'count',
} as const;
export type BatchMode = (typeof BatchMode)[keyof typeof BatchMode];

export const BatchGrouping = {
    Test: 'test',
    Project: 'project',
} as const;
export type BatchGrouping = (typeof BatchGrouping)[keyof typeof BatchGrouping];

export interface BatchOptions {
    batchMode: BatchMode;
    batchTarget?: number;
    batchGrouping: BatchGrouping;
}

export interface TestItem {
    testId: string;
    file: string;
    position: string;
    project: string;
    order: number;
    timeout: number;
    children?: string[];
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
    batchOptions: BatchOptions;
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
    test: TestItem;
    item: HistoryItem;
    historyWindow: number;
    newEma: number;
    title: string;
}
