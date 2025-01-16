import { TestRun, TestRunConfig, TestRunInfo } from './test-info';

export interface TestItem {
    file: string;
    position: string;
    project: string;
    order: number;
    timeout: number;
}

export abstract class Adapter {
    abstract getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined>;
    abstract finishTest(runId: string, test: TestItem): Promise<void>;
    abstract failTest(runId: string, test: TestItem): Promise<void>;
    abstract saveTestRun(runId: string, testRun: TestRunInfo, args: string[]): Promise<void>;
    abstract initialize(): Promise<void>;
    abstract startShard(runId: string): Promise<TestRunConfig>;
    abstract finishShard(runId: string): Promise<void>;
    abstract dispose(): Promise<void>;
    protected flattenTestRun(run: TestRun, reverse = false): TestItem[] {
        return Object.entries(run)
            .flatMap(([file, tests]) => {
                return Object.entries(tests).flatMap(([position, { timeout, projects }]) => {
                    return projects.flatMap((project) => {
                        return { file, position, project, timeout };
                    });
                });
            })
            .sort((a, b) => (b.timeout - a.timeout) * (reverse ? -1 : 1))
            .map((test, i) => ({ ...test, order: i + 1 }));
    }
}
