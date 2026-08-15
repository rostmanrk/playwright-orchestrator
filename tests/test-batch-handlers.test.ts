import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CountBatchHandler } from '../packages/core/src/batch/count-batch-handler.js';
import { TimeBatchHandler } from '../packages/core/src/batch/time-batch-handler.js';
import { BaseBatchHandler } from '../packages/core/src/batch/base-batch-handler.js';
import { AutoBatchHandler } from '../packages/core/src/batch/auto-batch-handler.js';
import type { ShardHandler } from '../packages/core/src/adapters/shard-handler.js';
import type { TestItem, TestRunConfig } from '../packages/core/src/types/adapters.js';
import { Grouping, BatchMode } from '../packages/core/src/types/adapters.js';

function makeConfig(options: Partial<TestRunConfig['options']> = {}): TestRunConfig {
    return {
        workers: 1,
        projects: [],
        args: [],
        options: {
            batchMode: BatchMode.Off,
            grouping: Grouping.Project,
            historyWindow: 10,
            batchTarget: 3,
            ...options,
        },
    };
}

function makeTest(id: string, project = 'chrome', ema = 0): TestItem {
    return {
        testId: id,
        order: 1,
        timeout: 5000,
        ema,
        meta: {
            title: id,
            projects: [project],
            file: `${id}.spec.ts`,
            position: '1:1',
            annotations: [],
        },
    };
}

function makeMockShardHandler() {
    return {
        startShard: vi.fn(),
        finishShard: vi.fn(),
        getNextTest: vi.fn(),
        getNextTestByProject: vi.fn(),
        getRemainingCounters: vi.fn(),
    };
}

function injectShardHandler(handler: BaseBatchHandler, mock: ShardHandler) {
    (handler as any).shardHandler = mock;
}

// ─── BaseBatchHandler routing ─────────────────────────────────────────────────

describe('BaseBatchHandler.getNextTest routing', () => {
    let handler: BaseBatchHandler;
    let mock: ReturnType<typeof makeMockShardHandler>;

    beforeEach(() => {
        handler = new BaseBatchHandler();
        mock = makeMockShardHandler();
        injectShardHandler(handler, mock);
        mock.getNextTest.mockResolvedValue(undefined);
        mock.getNextTestByProject.mockResolvedValue(undefined);
    });

    it('Grouping.Test always calls getNextTest regardless of project arg', async () => {
        await handler.getNextTest(makeConfig({ grouping: Grouping.Test }), 'chrome');
        expect(mock.getNextTest).toHaveBeenCalledWith(makeConfig({ grouping: Grouping.Test }));
        expect(mock.getNextTestByProject).not.toHaveBeenCalled();
    });

    it('Grouping.Project with project calls getNextTestByProject', async () => {
        await handler.getNextTest(makeConfig({ grouping: Grouping.Project }), 'chrome');
        expect(mock.getNextTestByProject).toHaveBeenCalledWith('chrome');
        expect(mock.getNextTest).not.toHaveBeenCalled();
    });

    it('Grouping.Project without project falls back to getNextTest', async () => {
        await handler.getNextTest(makeConfig({ grouping: Grouping.Project }), undefined);
        expect(mock.getNextTest).toHaveBeenCalledWith(makeConfig({ grouping: Grouping.Project }));
        expect(mock.getNextTestByProject).not.toHaveBeenCalled();
    });
});

// ─── CountBatchHandler ────────────────────────────────────────────────────────

describe('CountBatchHandler.getNextBatch', () => {
    let handler: CountBatchHandler;
    let mock: ReturnType<typeof makeMockShardHandler>;

    beforeEach(() => {
        handler = new CountBatchHandler();
        mock = makeMockShardHandler();
        injectShardHandler(handler, mock);
    });

    it('returns exactly batchTarget tests when queue is large enough', async () => {
        // Project grouping: first call uses getNextTest (no prior project),
        // subsequent calls use getNextTestByProject with previous test's project.
        mock.getNextTest.mockResolvedValueOnce(makeTest('a', 'chrome'));
        mock.getNextTestByProject
            .mockResolvedValueOnce(makeTest('b', 'chrome'))
            .mockResolvedValueOnce(makeTest('c', 'chrome'));

        const result = await handler.getNextBatch(makeConfig({ batchTarget: 3 }));
        expect(result).toHaveLength(3);
        expect(result!.map((t) => t.testId)).toEqual(['a', 'b', 'c']);
    });

    it('first call always uses getNextTest; subsequent use getNextTestByProject', async () => {
        mock.getNextTest.mockResolvedValueOnce(makeTest('a', 'chrome'));
        mock.getNextTestByProject.mockResolvedValueOnce(makeTest('b', 'chrome'));

        await handler.getNextBatch(makeConfig({ batchTarget: 2 }));

        expect(mock.getNextTest).toHaveBeenCalledTimes(1);
        expect(mock.getNextTestByProject).toHaveBeenCalledWith('chrome');
    });

    it('returns fewer tests when queue is exhausted before batchTarget', async () => {
        mock.getNextTest.mockResolvedValueOnce(makeTest('a'));
        mock.getNextTestByProject.mockResolvedValueOnce(undefined);

        const result = await handler.getNextBatch(makeConfig({ batchTarget: 5 }));
        expect(result).toHaveLength(1);
    });

    it('returns undefined when queue is empty', async () => {
        mock.getNextTest.mockResolvedValueOnce(undefined);

        const result = await handler.getNextBatch(makeConfig({ batchTarget: 3 }));
        expect(result).toBeUndefined();
    });

    it('uses Grouping.Test: only calls getNextTest (never getNextTestByProject)', async () => {
        mock.getNextTest
            .mockResolvedValueOnce(makeTest('a'))
            .mockResolvedValueOnce(makeTest('b'))
            .mockResolvedValueOnce(undefined);

        await handler.getNextBatch(makeConfig({ batchTarget: 5, grouping: Grouping.Test }));
        expect(mock.getNextTestByProject).not.toHaveBeenCalled();
    });
});

// ─── TimeBatchHandler ─────────────────────────────────────────────────────────

describe('TimeBatchHandler.getNextBatch', () => {
    let handler: TimeBatchHandler;
    let mock: ReturnType<typeof makeMockShardHandler>;

    beforeEach(() => {
        handler = new TimeBatchHandler();
        mock = makeMockShardHandler();
        injectShardHandler(handler, mock);
    });

    // Uses Grouping.Test so all fetches go through getNextTest only.
    function configTime(batchTarget: number): TestRunConfig {
        return makeConfig({ batchTarget, grouping: Grouping.Test });
    }

    it('stops after budget exhausted by previous test ema', async () => {
        // batchTarget=10s → budget=10000, threshold=1000
        // iter1: cond 11000>0 ✓, fetch 3s, budget=7000
        // iter2: cond 8000>3000 ✓, fetch 4s, budget=3000
        // iter3: cond 4000>4000 ✗ (strict >), stop — 2s test never fetched
        mock.getNextTest
            .mockResolvedValueOnce(makeTest('a', 'chrome', 3000))
            .mockResolvedValueOnce(makeTest('b', 'chrome', 4000));

        const result = await handler.getNextBatch(configTime(10));
        expect(result!.map((t) => t.testId)).toEqual(['a', 'b']);
        expect(mock.getNextTest).toHaveBeenCalledTimes(2);
    });

    it('first test always taken regardless of ema (condition starts at prev=undefined→0)', async () => {
        // budget=10000, threshold=1000; iter1: cond 11000>0 ✓, fetch 9s, budget=1000
        // iter2: cond 2000>9000 ✗, stop
        mock.getNextTest.mockResolvedValueOnce(makeTest('a', 'chrome', 9000));

        const result = await handler.getNextBatch(configTime(10));
        expect(result!.map((t) => t.testId)).toEqual(['a']);
    });

    it('zero-ema tests: all taken until queue empty (budget never decreases)', async () => {
        mock.getNextTest
            .mockResolvedValueOnce(makeTest('a', 'chrome', 0))
            .mockResolvedValueOnce(makeTest('b', 'chrome', 0))
            .mockResolvedValueOnce(makeTest('c', 'chrome', 0))
            .mockResolvedValueOnce(undefined);

        const result = await handler.getNextBatch(configTime(10));
        expect(result!).toHaveLength(3);
    });

    it('returns undefined when queue is empty from the start', async () => {
        mock.getNextTest.mockResolvedValueOnce(undefined);

        const result = await handler.getNextBatch(configTime(10));
        expect(result).toBeUndefined();
    });
});

// ─── AutoBatchHandler ────────────────────────────────────────────────────────

describe('AutoBatchHandler.getNextBatch', () => {
    let handler: AutoBatchHandler;
    let mock: ReturnType<typeof makeMockShardHandler>;

    beforeEach(() => {
        handler = new AutoBatchHandler();
        mock = makeMockShardHandler();
        injectShardHandler(handler, mock);
    });

    function configAuto(): TestRunConfig {
        return makeConfig({ batchMode: BatchMode.Auto, grouping: Grouping.Test });
    }

    it('always takes at least one test even if counters start at 0', async () => {
        mock.getNextTest.mockResolvedValueOnce(makeTest('a', 'chrome', 5000));
        mock.getRemainingCounters.mockResolvedValue({ remainingCount: 0, remainingTime: 0 });

        const result = await handler.getNextBatch(configAuto());
        expect(result).toHaveLength(1);
    });

    it('stops at count cap ceil(sqrt(N))', async () => {
        // N=4: cap=2, budget=4000/sqrt(4)=2000.
        // After test1 (accumulated=1000): 1000 < 2000 and 1 < 2 → take test2.
        // N=2: cap=ceil(sqrt(2))=2, budget=40000/sqrt(2)≈28284.
        // After test2 (accumulated=2000): batch.length=2 >= cap=2 → stop by cap (budget not reached).
        mock.getRemainingCounters
            .mockResolvedValueOnce({ remainingCount: 4, remainingTime: 4000 })
            .mockResolvedValue({ remainingCount: 2, remainingTime: 40000 });
        mock.getNextTest
            .mockResolvedValueOnce(makeTest('a', 'chrome', 1000))
            .mockResolvedValueOnce(makeTest('b', 'chrome', 1000));

        const result = await handler.getNextBatch(configAuto());
        expect(result!.map((t) => t.testId)).toEqual(['a', 'b']);
    });

    it('stops at duration budget T/sqrt(N)', async () => {
        // N=4, T=8000: budget=4000, cap=2.
        // After test1 (ema=3000): accumulated=3000 < 4000 → take test2.
        // After test2 (ema=2000): accumulated=5000 >= 4000 → stop.
        mock.getRemainingCounters
            .mockResolvedValueOnce({ remainingCount: 4, remainingTime: 8000 })
            .mockResolvedValue({ remainingCount: 2, remainingTime: 3000 });
        mock.getNextTest
            .mockResolvedValueOnce(makeTest('a', 'chrome', 3000))
            .mockResolvedValueOnce(makeTest('b', 'chrome', 2000));

        const result = await handler.getNextBatch(configAuto());
        expect(result!.map((t) => t.testId)).toEqual(['a', 'b']);
    });

    it('returns undefined when queue is empty from the start', async () => {
        mock.getNextTest.mockResolvedValueOnce(undefined);

        const result = await handler.getNextBatch(configAuto());
        expect(result).toBeUndefined();
    });

    it('stops when remainingCount reaches 0 mid-batch', async () => {
        mock.getNextTest.mockResolvedValueOnce(makeTest('a', 'chrome', 5000));
        mock.getRemainingCounters.mockResolvedValueOnce({ remainingCount: 0, remainingTime: 0 });

        const result = await handler.getNextBatch(configAuto());
        expect(result).toHaveLength(1);
    });

    it('uses project affinity: subsequent calls use first test project', async () => {
        const config = makeConfig({ batchMode: BatchMode.Auto, grouping: Grouping.Project });
        // remainingCount=4: cap=2, budget=40000/2=20000 > accumulated=5000 → tries for test2
        mock.getRemainingCounters.mockResolvedValue({ remainingCount: 4, remainingTime: 40000 });
        mock.getNextTest.mockResolvedValueOnce(makeTest('a', 'chrome', 5000));
        mock.getNextTestByProject.mockResolvedValueOnce(undefined);

        await handler.getNextBatch(config);
        expect(mock.getNextTest).toHaveBeenCalledTimes(1);
        expect(mock.getNextTestByProject).toHaveBeenCalledWith('chrome');
    });
});
