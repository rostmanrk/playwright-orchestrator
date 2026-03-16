import type { TestDetailsAnnotation, FullConfig } from '@playwright/test';
import type { BatchOptions } from './adapters.js';

export type UseOptions = FullConfig['projects'][number]['use'];

export interface Project {
    name: string;
    outputDir: string;
    use: UseOptions;
}

export interface TestConfig {
    workers: number;
    configFile?: string;
    projects: Project[];
}

export interface TestRunConfig extends TestConfig {
    historyWindow: number;
    args: string[];
    status: RunStatus;
    updated: number;
    batchOptions?: BatchOptions;
}

export interface TestRunInfo {
    testRun: TestRun;
    config: TestConfig;
}

export interface TestRun {
    [file: string]: {
        [position: string]: {
            timeout: number;
            projects: string[];
            title: string;
            annotations: TestDetailsAnnotation[];
            children?: string[];
        };
    };
}

export const RunStatus = {
    Created: 0,
    Run: 10,
    RepeatRun: 20,
    Finished: 30,
} as const;
export type RunStatus = (typeof RunStatus)[keyof typeof RunStatus];

export const TestStatus = {
    Ready: 0,
    Ongoing: 10,
    Failed: 20,
    Passed: 30,
} as const;
export type TestStatus = (typeof TestStatus)[keyof typeof TestStatus];
