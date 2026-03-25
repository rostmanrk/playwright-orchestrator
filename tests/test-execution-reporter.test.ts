import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TestItem } from '../packages/core/src/types/adapters.js';
import { TestExecutionReporter } from '../packages/core/src/runner/test-execution-reporter.js';

function makeTest(id: string): TestItem {
    return {
        testId: id,
        file: `tests/${id}.spec.ts`,
        position: '10:5',
        projects: ['chrome'],
        children: undefined,
        order: 0,
    } as unknown as TestItem;
}

function deferred() {
    let resolve!: () => void;
    let reject!: (err?: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('TestExecutionReporter groups', () => {
    let reporter: TestExecutionReporter;
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        vi.useFakeTimers();
        reporter = new TestExecutionReporter();
        consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        reporter.printSummary();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('addTest throws if group does not exist', () => {
        const t = makeTest('a');
        const { promise } = deferred();
        expect(() => reporter.addTest(t, 'sub-1', 'sub-1', promise)).toThrow(`Unknown group: ${t.testId}`);
    });

    it('batch persists as multi-line block with all groups and subtests', async () => {
        const batch = deferred();
        const group = deferred();
        const child1 = deferred();
        const child2 = deferred();
        const t = makeTest('t');

        reporter.addBatch('Batch 1', batch.promise);
        reporter.addGroup('Batch 1', t, group.promise);
        reporter.addTest(t, 'sub-1', 'sub-1', child1.promise);
        vi.advanceTimersByTime(1000);
        reporter.addTest(t, 'sub-2', 'sub-2', child2.promise);
        vi.advanceTimersByTime(1000);
        child1.resolve();
        await Promise.resolve();
        await Promise.resolve();
        child2.reject(new Error('fail'));
        await Promise.resolve();
        await Promise.resolve();

        group.resolve();
        await Promise.resolve();
        await Promise.resolve();

        batch.resolve();
        await Promise.resolve();
        await Promise.resolve();

        const batchCall = consoleSpy.mock.calls.find(
            ([msg]) => typeof msg === 'string' && msg.includes('Batch 1') && msg.includes('└─'),
        );
        expect(batchCall).toBeDefined();
        const output = batchCall![0] as string;
        expect(output).toContain('Batch 1');
        expect(output).toContain('t');
        expect(output).toContain('sub-1');
        expect(output).toContain('sub-2');
        expect(output).toMatch(/✓.*sub-1/s);
        expect(output).toMatch(/✗.*sub-2/s);
    });

    it('group timer pauses when no subtests running and resumes on next addTest (scenario c)', async () => {
        const batch = deferred();
        const group = deferred();
        const child1 = deferred();
        const child2 = deferred();
        const t = makeTest('t');

        reporter.addBatch('Batch 1', batch.promise);
        reporter.addGroup('Batch 1', t, group.promise);

        reporter.addTest(t, 'sub-1', 'sub-1', child1.promise);
        vi.advanceTimersByTime(2000);
        child1.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Idle 1s — should NOT count
        vi.advanceTimersByTime(1000);

        reporter.addTest(t, 'sub-2', 'sub-2', child2.promise);
        vi.advanceTimersByTime(3000);
        child2.resolve();
        await Promise.resolve();
        await Promise.resolve();

        group.resolve();
        await Promise.resolve();
        await Promise.resolve();

        batch.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Group elapsed should be ~5s (2s + 3s), not 6s
        const batchCall = consoleSpy.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('Batch 1'));
        expect(batchCall![0]).toContain('5.0s');
    });

    it('two overlapping subtests keep group timer running continuously (scenario b)', async () => {
        const batch = deferred();
        const group = deferred();
        const child1 = deferred();
        const child2 = deferred();
        const t = makeTest('t');

        reporter.addBatch('Batch 1', batch.promise);
        reporter.addGroup('Batch 1', t, group.promise);
        reporter.addTest(t, 'sub-1', 'sub-1', child1.promise);
        vi.advanceTimersByTime(1000);
        reporter.addTest(t, 'sub-2', 'sub-2', child2.promise);
        vi.advanceTimersByTime(2000);
        child1.resolve();
        await Promise.resolve();
        await Promise.resolve();
        vi.advanceTimersByTime(1000);
        child2.resolve();
        await Promise.resolve();
        await Promise.resolve();

        group.resolve();
        await Promise.resolve();
        await Promise.resolve();

        batch.resolve();
        await Promise.resolve();
        await Promise.resolve();

        // Group timer ran continuously 0→4s = 4.0s
        const batchCall = consoleSpy.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('Batch 1'));
        expect(batchCall![0]).toContain('4.0s');
    });

    it('failed batch persists a red line', async () => {
        const batch = deferred();
        const group = deferred();
        const child = deferred();
        const t = makeTest('t');

        reporter.addBatch('Batch 1', batch.promise);
        reporter.addGroup('Batch 1', t, group.promise);
        reporter.addTest(t, 'sub-1', 'sub-1', child.promise);
        vi.advanceTimersByTime(1000);
        child.reject();
        await Promise.resolve();
        await Promise.resolve();
        group.reject(new Error('fail'));
        await Promise.resolve();
        await Promise.resolve();
        batch.reject(new Error('oops'));
        await Promise.resolve();
        await Promise.resolve();

        const batchCall = consoleSpy.mock.calls.find(([msg]) => typeof msg === 'string' && msg.includes('Batch 1'));
        expect(batchCall![0]).toMatch(/✗.*Batch 1/);
    });

    it('addBatch and addGroup are idempotent', () => {
        const t = makeTest('t');
        const b1 = deferred();
        const b2 = deferred();
        const g1 = deferred();
        const g2 = deferred();
        reporter.addBatch('Batch 1', b1.promise);
        reporter.addBatch('Batch 1', b2.promise); // no-op
        reporter.addGroup('Batch 1', t, g1.promise);
        reporter.addGroup('Batch 1', t, g2.promise); // no-op
        expect(() => {
            b2.resolve();
            g2.resolve();
        }).not.toThrow();
    });
});
