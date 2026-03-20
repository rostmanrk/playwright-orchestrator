import type { TestItem, TestRunConfig } from '../types/adapters.js';

export interface BatchHandler {
    getNextBatch(runId: string, config: TestRunConfig): Promise<TestItem[] | undefined>;
}
