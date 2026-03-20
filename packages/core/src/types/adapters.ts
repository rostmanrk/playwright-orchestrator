import type { TestReportResult } from './reporter.js';
import type { RunStatus, TestConfig, TestStatus } from './test-info.js';
import type { TestDetailsAnnotation } from '@playwright/test';

export const BatchMode = {
    Off: 'off',
    Time: 'time',
    Count: 'count',
} as const;
export type BatchMode = (typeof BatchMode)[keyof typeof BatchMode];

export const Grouping = {
    Test: 'test',
    Project: 'project',
} as const;
export type Grouping = (typeof Grouping)[keyof typeof Grouping];

export interface TestRunConfig extends TestConfig {
    args: string[];
    options: BaseOptions;
    version?: string;
}

export interface TestRun {
    status: RunStatus;
    updated: number;
    config: TestRunConfig;
}

export interface BaseOptions {
    batchMode: BatchMode;
    batchTarget?: number;
    grouping: Grouping;
    historyWindow: number;
}

export interface TestItem {
    testId: string;
    file: string;
    position: string;
    projects: string[];
    order: number;
    timeout: number;
    children?: string[];
    ema: number;
}

export interface ResultTestParams {
    runId: string;
    test: TestItem;
    testResult: TestReportResult;
    config: TestRunConfig;
}

export interface SaveTestRunParams {
    runId: string;
    args: string[];
    options: BaseOptions;
}

export interface GetTestIdParams {
    project?: string;
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
}
