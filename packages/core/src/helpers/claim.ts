import type { TestRun } from '../types/adapters.js';

/** Default for `--heartbeat-interval`: how often a running shard moves its `aliveUntil` forward */
export const DEFAULT_HEARTBEAT_INTERVAL = 15 * 1000;

/** Default for `--heartbeat-timeout`: how long a shard counts as alive after its last heartbeat */
export const DEFAULT_HEARTBEAT_TIMEOUT = 60 * 1000;

/** `aliveUntil` a shard writes when it starts and on each heartbeat */
export function getAliveUntil(heartbeatTimeout: number, now = Date.now()): number {
    return now + heartbeatTimeout;
}

/**
 * Shards whose claimed tests a repeat run queues again: those without a heartbeat since `aliveUntil`, and the
 * current shard. The current shard has only just started, so tests claimed under its id come from an earlier
 * process with the same id, e.g. a CI retry. `finished` is not used: CI reuses shard ids, so a shard
 * that finished the first run may be running the repeat run.
 */
export function getDeadShardIds(
    shards: TestRun['shards'] | undefined,
    currentShardId: string,
    now = Date.now(),
): string[] {
    const expired = Object.entries(shards ?? {})
        .filter(([shardId, shard]) => shardId !== currentShardId && (shard.aliveUntil ?? 0) < now)
        .map(([shardId]) => shardId);
    return [currentShardId, ...expired];
}
