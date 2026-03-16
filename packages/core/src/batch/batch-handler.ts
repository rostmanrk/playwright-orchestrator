import type { TestItem } from '../types/adapters.js';
import type { TestRunConfig } from '../types/test-info.js';

export interface BatchHandler {
    getNextBatch(runId: string, config: TestRunConfig): Promise<TestItem[] | undefined>;
}
