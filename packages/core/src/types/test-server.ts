import { TestResult } from '@playwright/test/reporter';
import { TestDetailsAnnotation } from 'playwright/test';

export interface TestServerLocation {
    file: string;
    line: number;
    column: number;
}

export interface TestServerTestEntry {
    testId: string;
    title: string;
    location: TestServerLocation;
    retries: number;
    tags: string[];
    repeatEachIndex: number;
    annotations: TestDetailsAnnotation[];
}

export interface TestServerSuiteEntry {
    title: string;
    location: TestServerLocation;
    entries: (TestServerTestEntry | TestServerSuiteEntry)[];
}

export interface TestServerGrepPattern {
    r: { source: string; flags: string };
}

export interface TestServerTestMatchPattern {
    s: string;
}

export interface TestServerProject {
    metadata: { actualWorkers: number };
    name: string;
    outputDir: string;
    repeatEach: number;
    retries: number;
    testDir: string;
    testIgnore: string[];
    testMatch: TestServerTestMatchPattern[];
    timeout: number;
    suites: TestServerSuiteEntry[];
    grep: TestServerGrepPattern[];
    grepInvert: unknown[];
    dependencies: string[];
    snapshotDir: string;
    use: Record<string, unknown>;
}

export interface OnProjectMessage {
    method: 'onProject';
    params: {
        project: TestServerProject;
    };
}

export interface OnTestBeginResult {
    id: string;
    retry: number;
    workerIndex: number;
    parallelIndex: number;
    startTime: number;
}

export interface OnTestBeginArgs {
    testId: string;
    result: OnTestBeginResult;
}

export interface OnTestBeginMessage {
    method: 'onTestBegin';
    params: OnTestBeginArgs;
}

export interface OnTestEndTest {
    testId: string;
    expectedStatus: string;
    timeout: number;
    annotations: TestDetailsAnnotation[];
}

export interface OnTestEndResult {
    id: string;
    duration: number;
    status: TestResult['status'];
    errors: TestResult['error'][];
}

export interface OnTestEndArgs {
    test: OnTestEndTest;
    result: OnTestEndResult;
}

export interface OnTestEndMessage {
    method: 'onTestEnd';
    params: OnTestEndArgs;
}
