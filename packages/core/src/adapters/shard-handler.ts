import type { TestItem, TestRunConfig } from '../types/adapters.js';

export interface ShardHandler {
    startShard(): Promise<TestRunConfig>;
    finishShard(): Promise<void>;
    /** Claims the next test, with the deadline from `getClaimDeadline` */
    getNextTest(config: TestRunConfig): Promise<TestItem | undefined>;
    getNextTestByProject(project: string): Promise<TestItem | undefined>;
    /**
     * Replaces the claim deadline of a batch's tests once the batch is ready. Null removes it. A repeat run (`startShard` on a finished run) queues
     * again the claimed tests without a result whose deadline has passed, or all of them when every other
     * shard has finished (`everyOtherShardFinished`).
     */
    setClaimDeadline(tests: TestItem[], deadline: number | null): Promise<void>;
    getRemainingCounters(config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }>;
}
