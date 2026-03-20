import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BaseAdapter } from '../packages/core/src/adapters/base-adapter.js';
import type { TestItem, HistoryItem } from '../packages/core/src/types/adapters.js';
import { TestStatus } from '../packages/core/src/types/test-info.js';

class TestableAdapter extends BaseAdapter {
    getReportData = vi.fn();
    getTestEma = vi.fn();
    saveTestResult = vi.fn();

    ema(current: number, prev: number, window: number): number {
        return this.calculateEMA(current, prev, window);
    }

    report(test: TestItem, item: HistoryItem, newEma: number, history: HistoryItem[]) {
        return this.buildReport(test, item, newEma, history);
    }
}

function makeTestItem(overrides: Partial<TestItem> = {}): TestItem {
    return {
        testId: 'foo.spec.ts > my test',
        file: 'foo.spec.ts',
        position: '5:3',
        projects: ['chrome'],
        order: 1,
        timeout: 5000,
        ema: 0,
        ...overrides,
    };
}

describe('BaseAdapter.calculateEMA', () => {
    let adapter: TestableAdapter;

    beforeEach(() => {
        adapter = new TestableAdapter();
    });

    it('bootstrap: returns current when ema is 0', () => {
        expect(adapter.ema(500, 0, 10)).toBe(500);
    });

    it('correct weighted average: window=10, k=2/11', () => {
        const k = 2 / 11;
        const expected = 1000 * k + 500 * (1 - k);
        expect(adapter.ema(1000, 500, 10)).toBeCloseTo(expected);
    });

    it('window=1 (k=1) always returns current', () => {
        expect(adapter.ema(300, 999, 1)).toBe(300);
    });

    it('stable: current === ema stays the same', () => {
        expect(adapter.ema(500, 500, 10)).toBeCloseTo(500);
    });
});

describe('BaseAdapter.buildReport', () => {
    let adapter: TestableAdapter;

    beforeEach(() => {
        adapter = new TestableAdapter();
    });

    it('maps all fields correctly', () => {
        const test = makeTestItem();
        const item: HistoryItem = { status: TestStatus.Passed, duration: 1200, updated: 1000 };
        const report = adapter.report(test, item, 1100, [item]);

        expect(report.file).toBe('foo.spec.ts');
        expect(report.position).toBe('5:3');
        expect(report.projects).toEqual(['chrome']);
        expect(report.status).toBe(TestStatus.Passed);
        expect(report.duration).toBe(1200);
        expect(report.averageDuration).toBe(1100);
        expect(report.title).toBe('foo.spec.ts > my test'); // title is test.testId
    });

    it('counts only failed history items', () => {
        const test = makeTestItem();
        const item: HistoryItem = { status: TestStatus.Failed, duration: 100, updated: 3000 };
        const history: HistoryItem[] = [
            { status: TestStatus.Failed, duration: 100, updated: 1000 },
            { status: TestStatus.Passed, duration: 100, updated: 2000 },
            { status: TestStatus.Failed, duration: 100, updated: 3000 },
        ];
        expect(adapter.report(test, item, 0, history).fails).toBe(2);
    });

    it('lastSuccessfulRunTimestamp is the last passing item updated', () => {
        const test = makeTestItem();
        const item: HistoryItem = { status: TestStatus.Failed, duration: 100, updated: 3000 };
        const history: HistoryItem[] = [
            { status: TestStatus.Passed, duration: 100, updated: 1000 },
            { status: TestStatus.Passed, duration: 100, updated: 2000 },
            { status: TestStatus.Failed, duration: 100, updated: 3000 },
        ];
        expect(adapter.report(test, item, 0, history).lastSuccessfulRunTimestamp).toBe(2000);
    });

    it('lastSuccessfulRunTimestamp is undefined when no passing runs', () => {
        const test = makeTestItem();
        const item: HistoryItem = { status: TestStatus.Failed, duration: 100, updated: 1000 };
        const history: HistoryItem[] = [{ status: TestStatus.Failed, duration: 100, updated: 1000 }];
        expect(adapter.report(test, item, 0, history).lastSuccessfulRunTimestamp).toBeUndefined();
    });
});
