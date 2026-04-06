import type { TestItem, TestRunConfig } from '../types/adapters.js';

export interface ShardHandler {
    startShard(): Promise<TestRunConfig>;
    finishShard(): Promise<void>;
    getNextTest(config: TestRunConfig): Promise<TestItem | undefined>;
    getNextTestByProject(project: string): Promise<TestItem | undefined>;
}
