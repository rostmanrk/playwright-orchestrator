import type { TestDetailsAnnotation, FullConfig } from '@playwright/test';

export type UseOptions = FullConfig['projects'][number]['use'];

export interface Project {
    name: string;
    use: UseOptions;
    repeatEach: number;
    dependencies: string[];
    teardown?: string;
}

export interface TestConfig {
    workers: number;
    configFile?: string;
    projects: Project[];
}

export interface ReporterTestRunInfo {
    testRun: ReporterTestRun;
    config: TestConfig;
}

export interface ReporterTestRun {
    [file: string]: {
        [position: string]: {
            [title: string]: {
                timeout: number;
                projects: string[];
                annotations: TestDetailsAnnotation[];
                children?: string[];
                /** Describe titles followed by the test title; for a serial group, the path to the group (empty when the whole file is serial) */
                titlePath: string[];
            };
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
