import type { TestItem, TestRunConfig } from '../types/adapters.js';

export interface BatchHandler {
    getNextBatch(config: TestRunConfig): Promise<TestItem[] | undefined>;
}
