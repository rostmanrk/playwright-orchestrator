import { TestDetailsAnnotation } from '@playwright/test';

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

export enum RunStatus {
    Created = 0,
    Run = 10,
    RepeatRun = 20,
    Finished = 30,
}

export enum TestStatus {
    Ready = 0,
    Ongoing = 10,
    Failed = 20,
    Passed = 30,
}
