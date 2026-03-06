import type { TestDetailsAnnotation } from '@playwright/test';

export interface Project {
    name: string;
    outputDir: string;
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
