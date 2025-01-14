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
        };
    };
}

export interface Annotation {
    type: string;
    description?: string;
}

export enum RunStatus {
    Created = 0,
    Run = 10,
    Rerun = 20,
    Finished = 30,
}

export enum TestStatus {
    Ready = 0,
    Running = 10,
    Failed = 20,
    Passed = 30,
}
