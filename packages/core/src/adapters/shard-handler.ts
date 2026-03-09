import type { TestItem } from '../types/adapters.js';
import type { TestRunConfig } from '../types/test-info.js';

export interface ShardHandler {
    startShard(runId: string): Promise<TestRunConfig>;
    finishShard(runId: string): Promise<void>;
    getNextTest(runId: string, config: TestRunConfig): Promise<TestItem | undefined>;
}
