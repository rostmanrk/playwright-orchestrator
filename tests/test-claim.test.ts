import { describe, it, expect } from 'vitest';
import {
    CLAIM_MARGIN,
    everyOtherShardFinished,
    getBatchDeadline,
    getTestBudget,
} from '../packages/core/src/helpers/claim.js';
import type { TestItem, TestRunConfig } from '../packages/core/src/types/adapters.js';
import { BatchMode, Grouping } from '../packages/core/src/types/adapters.js';

function makeConfig(): TestRunConfig {
    return {
        workers: 1,
        projects: [
            { name: 'chrome', use: {}, repeatEach: 1, retries: 0, dependencies: [] },
            { name: 'firefox', use: {}, repeatEach: 2, retries: 1, dependencies: [] },
        ],
        args: [],
        options: { batchMode: BatchMode.Count, grouping: Grouping.Test, historyWindow: 10 },
    };
}

function makeTest(timeout: number, projects = ['chrome']): TestItem {
    return {
        testId: `test ${timeout}`,
        order: 1,
        timeout,
        ema: 0,
        meta: { file: 'a.spec.ts', position: '1:1', projects, annotations: [], titlePath: [] },
    };
}

describe('getTestBudget', () => {
    it('covers every attempt and repeat in every project', () => {
        // chrome: 1 repeat x 1 attempt, firefox: 2 repeats x 2 attempts
        expect(getTestBudget(makeTest(1000, ['chrome', 'firefox']), makeConfig())).toBe(5000);
    });

    it('is unbounded for a test without a timeout', () => {
        expect(getTestBudget(makeTest(0), makeConfig())).toBe(Infinity);
    });
});

describe('getBatchDeadline', () => {
    it('adds the budgets of every test in the batch and the margin to the start', () => {
        expect(getBatchDeadline([makeTest(1000), makeTest(2000)], makeConfig(), 100)).toBe(3100 + CLAIM_MARGIN);
    });

    it('is null when a test has no timeout', () => {
        expect(getBatchDeadline([makeTest(1000), makeTest(0)], makeConfig(), 100)).toBeNull();
    });

    it('is null when the start is unknown', () => {
        expect(getBatchDeadline([makeTest(1000)], makeConfig(), Infinity)).toBeNull();
    });
});

describe('everyOtherShardFinished', () => {
    it('ignores the current shard', () => {
        const shards = {
            done: { shardId: 'done', started: 0, finished: 1 },
            current: { shardId: 'current', started: 0 },
        };
        expect(everyOtherShardFinished(shards, 'current')).toBe(true);
    });

    it('is false while another shard has not finished', () => {
        const shards = {
            done: { shardId: 'done', started: 0, finished: 1 },
            killed: { shardId: 'killed', started: 0 },
        };
        expect(everyOtherShardFinished(shards, 'current')).toBe(false);
    });
});
