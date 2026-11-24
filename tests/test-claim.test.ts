import { describe, it, expect } from 'vitest';
import { getAliveUntil, getDeadShardIds } from '../packages/core/src/helpers/claim.js';

describe('getAliveUntil', () => {
    it('adds the heartbeat timeout to now', () => {
        expect(getAliveUntil(60_000, 1000)).toBe(61_000);
    });
});

describe('getDeadShardIds', () => {
    it('includes shards whose aliveUntil has passed', () => {
        const shards = {
            expired: { shardId: 'expired', started: 0, aliveUntil: 999 },
            alive: { shardId: 'alive', started: 0, aliveUntil: 1001 },
        };
        expect(getDeadShardIds(shards, 'current', 1000)).toEqual(['current', 'expired']);
    });

    it('keeps a finished shard alive until its aliveUntil, since its id may be running the repeat run', () => {
        const shards = { reused: { shardId: 'reused', started: 0, finished: 500, aliveUntil: 1001 } };
        expect(getDeadShardIds(shards, 'current', 1000)).toEqual(['current']);
    });

    it('always includes the current shard, whose earlier claims come from a process with the same id', () => {
        const shards = { current: { shardId: 'current', started: 0, aliveUntil: 5000 } };
        expect(getDeadShardIds(shards, 'current', 1000)).toEqual(['current']);
    });

    it('includes a shard that never wrote aliveUntil', () => {
        expect(getDeadShardIds({ old: { shardId: 'old', started: 0 } }, 'current', 1000)).toEqual(['current', 'old']);
    });
});
