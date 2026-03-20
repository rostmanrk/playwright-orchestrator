import { describe, it, expect, vi } from 'vitest';
import { BaseTestRunCreator } from '../packages/core/src/adapters/base-test-run-creator.js';
import type { TestItem, TestSortItem, TestRun, BaseOptions } from '../packages/core/src/types/adapters.js';
import { Grouping, BatchMode } from '../packages/core/src/types/adapters.js';
import type { ReporterTestRunInfo } from '../packages/core/src/types/test-info.js';

class TestableCreator extends BaseTestRunCreator {
    testInfoMap: Map<string, TestSortItem> = new Map();
    savedTests: TestItem[] = [];
    savedRun?: TestRun;

    async loadTestInfos(_tests: TestItem[]): Promise<Map<string, TestSortItem>> {
        return this.testInfoMap;
    }

    async saveRunData(_runId: string, run: TestRun, tests: TestItem[]): Promise<void> {
        this.savedTests = tests;
        this.savedRun = run;
    }
}

function makeRunInfo(testRun: ReporterTestRunInfo['testRun']): ReporterTestRunInfo {
    return { testRun, config: { workers: 1, projects: [] } };
}

function makeOptions(overrides: Partial<BaseOptions> = {}): BaseOptions {
    return {
        batchMode: BatchMode.Off,
        grouping: Grouping.Project,
        historyWindow: 10,
        ...overrides,
    };
}

function makeCreator(runInfo: ReporterTestRunInfo): TestableCreator {
    const creator = new TestableCreator();
    (creator as any).runInfoLoader = { load: vi.fn().mockResolvedValue(runInfo) };
    return creator;
}

// Helper: single-test run with project grouping.
// Resulting testId: '[chrome] a.spec.ts > test a'
const SINGLE_TEST_RUN: ReporterTestRunInfo['testRun'] = {
    'a.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test a', annotations: [], children: undefined } },
};

describe('BaseTestRunCreator sort order', () => {
    it('sorts tests by EMA descending (highest ema = order 1)', async () => {
        const runInfo = makeRunInfo({
            'a.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test a', annotations: [], children: undefined } },
            'b.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test b', annotations: [], children: undefined } },
            'c.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test c', annotations: [], children: undefined } },
        });
        const creator = makeCreator(runInfo);
        creator.testInfoMap.set('[chrome] a.spec.ts > test a', { ema: 100, fails: 0 });
        creator.testInfoMap.set('[chrome] b.spec.ts > test b', { ema: 300, fails: 0 });
        creator.testInfoMap.set('[chrome] c.spec.ts > test c', { ema: 200, fails: 0 });

        await creator.create({ runId: 'r', args: [], options: makeOptions() });

        expect(creator.savedTests[0].testId).toBe('[chrome] b.spec.ts > test b'); // 300
        expect(creator.savedTests[1].testId).toBe('[chrome] c.spec.ts > test c'); // 200
        expect(creator.savedTests[2].testId).toBe('[chrome] a.spec.ts > test a'); // 100
    });

    it('failure adjustment boosts sort value: ema=100, fails=5, window=10 → adjusted=150 > ema=130', async () => {
        const runInfo = makeRunInfo({
            'a.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test a', annotations: [], children: undefined } },
            'b.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test b', annotations: [], children: undefined } },
        });
        const creator = makeCreator(runInfo);
        // A: ema=100, fails=5, window=10 → adjusted = 100 * (5/10 + 1) = 150
        creator.testInfoMap.set('[chrome] a.spec.ts > test a', { ema: 100, fails: 5 });
        // B: ema=130, fails=0 → value = 130
        creator.testInfoMap.set('[chrome] b.spec.ts > test b', { ema: 130, fails: 0 });

        await creator.create({ runId: 'r', args: [], options: makeOptions() });

        expect(creator.savedTests[0].testId).toBe('[chrome] a.spec.ts > test a'); // 150 > 130
    });

    it('new test (no history) uses timeout as sort value', async () => {
        const runInfo = makeRunInfo({
            'a.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'new', annotations: [], children: undefined } },
            'b.spec.ts': { '1:1': { timeout: 3000, projects: ['chrome'], title: 'known', annotations: [], children: undefined } },
        });
        const creator = makeCreator(runInfo);
        // a has no history — uses timeout=5000
        creator.testInfoMap.set('[chrome] b.spec.ts > known', { ema: 3000, fails: 0 });

        await creator.create({ runId: 'r', args: [], options: makeOptions() });

        expect(creator.savedTests[0].testId).toBe('[chrome] a.spec.ts > new'); // 5000 > 3000
    });

    it('order field is 1-indexed and ascending in result array', async () => {
        const runInfo = makeRunInfo({
            'a.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test', annotations: [], children: undefined } },
            'b.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test', annotations: [], children: undefined } },
        });
        const creator = makeCreator(runInfo);
        creator.testInfoMap.set('[chrome] a.spec.ts > test', { ema: 200, fails: 0 });
        creator.testInfoMap.set('[chrome] b.spec.ts > test', { ema: 100, fails: 0 });

        await creator.create({ runId: 'r', args: [], options: makeOptions() });

        expect(creator.savedTests[0].order).toBe(1);
        expect(creator.savedTests[1].order).toBe(2);
    });
});

describe('BaseTestRunCreator duplicate ID validation', () => {
    it('throws when two tests produce the same testId', async () => {
        const ID_TYPE = '@playwright-orchestrator/id';
        const runInfo = makeRunInfo({
            'a.spec.ts': { '1:1': { timeout: 5000, projects: ['chrome'], title: 'test', annotations: [{ type: ID_TYPE, description: 'dup' }], children: undefined } },
            'b.spec.ts': { '2:1': { timeout: 5000, projects: ['chrome'], title: 'test', annotations: [{ type: ID_TYPE, description: 'dup' }], children: undefined } },
        });
        const creator = makeCreator(runInfo);

        await expect(creator.create({ runId: 'r', args: [], options: makeOptions() })).rejects.toThrow(
            'a.spec.ts:1:1',
        );
    });
});

describe('BaseTestRunCreator grouping modes', () => {
    const RUN: ReporterTestRunInfo['testRun'] = {
        'a.spec.ts': {
            '1:1': {
                timeout: 5000,
                projects: ['chrome', 'firefox'],
                title: 'test a',
                annotations: [],
                children: undefined,
            },
        },
    };

    it('grouping=test: single TestItem with both projects merged', async () => {
        const creator = makeCreator(makeRunInfo(RUN));
        await creator.create({ runId: 'r', args: [], options: makeOptions({ grouping: Grouping.Test }) });

        expect(creator.savedTests).toHaveLength(1);
        expect(creator.savedTests[0].projects).toEqual(['chrome', 'firefox']);
        expect(creator.savedTests[0].testId).toBe('a.spec.ts > test a'); // no project prefix
    });

    it('grouping=project: one TestItem per project', async () => {
        const creator = makeCreator(makeRunInfo(RUN));
        await creator.create({ runId: 'r', args: [], options: makeOptions({ grouping: Grouping.Project }) });

        expect(creator.savedTests).toHaveLength(2);
        const ids = creator.savedTests.map((t) => t.testId).sort();
        expect(ids).toEqual(['[chrome] a.spec.ts > test a', '[firefox] a.spec.ts > test a']);
    });
});

describe('BaseTestRunCreator cleanArgs', () => {
    async function getArgs(args: string[]): Promise<string[]> {
        const creator = makeCreator(makeRunInfo(SINGLE_TEST_RUN));
        await creator.create({ runId: 'r', args, options: makeOptions() });
        return creator.savedRun!.config.args;
    }

    it('strips leading positional args before first -- flag', async () => {
        expect(await getArgs(['run', 'file', '--workers', '4'])).toEqual(['--workers', '4']);
    });

    it('returns full args when already starting with a -- flag', async () => {
        expect(await getArgs(['--workers', '4'])).toEqual(['--workers', '4']);
    });

    it('returns empty array when no -- flags present', async () => {
        expect(await getArgs(['run', 'file'])).toEqual([]);
    });
});
