import type { TestItem, TestRunConfig } from '../types/adapters.js';

export interface ShardHandler {
    startShard(runId: string): Promise<TestRunConfig>;
    finishShard(runId: string): Promise<void>;
    getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined>;
    getNextTestByProject(runId: string, project: string, config: TestRunConfig): Promise<TestItem | undefined>;
}
