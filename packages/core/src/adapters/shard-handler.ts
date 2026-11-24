import type { TestItem, TestRunConfig } from '../types/adapters.js';

export interface ShardHandler {
    /**
     * Records the shard, or refreshes the record of a shard with the same id, with `aliveUntil` from `getAliveUntil`.
     * A repeat run (on a finished run) also queues again the claimed tests without a result whose shard is dead
     * (`getDeadShardIds`).
     */
    startShard(): Promise<TestRunConfig>;
    finishShard(): Promise<void>;
    /** Claims the next test, recording the current shard in `meta.shardId` */
    getNextTest(config: TestRunConfig): Promise<TestItem | undefined>;
    getNextTestByProject(project: string): Promise<TestItem | undefined>;
    /** Moves the current shard's `aliveUntil` forward, so its claimed tests are not queued again while it runs */
    heartbeat(): Promise<void>;
    getRemainingCounters(config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }>;
}
