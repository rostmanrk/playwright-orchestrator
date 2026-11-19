import { describe, it, expect, vi } from 'vitest';
import { TestRunner } from '../packages/core/src/runner/test-runner.js';
import type { TestItem, TestRunConfig } from '../packages/core/src/types/adapters.js';
import { BatchMode, Grouping } from '../packages/core/src/types/adapters.js';
import type { TestExecutionReporter } from '../packages/core/src/runner/test-execution-reporter.js';

type Deferred = { promise: Promise<void>; resolve: () => void; reject: (reason: unknown) => void };

function defer(): Deferred {
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<void>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeConfig(workers: number): TestRunConfig {
    return {
        workers,
        projects: [],
        args: [],
        options: { batchMode: BatchMode.Off, grouping: Grouping.Project, historyWindow: 10, batchTarget: 1 },
    };
}

function makeBatch(id: string): TestItem[] {
    return [
        {
            testId: id,
            order: 0,
            timeout: 5000,
            ema: 0,
            meta: {
                file: 'tests/foo.spec.ts',
                position: '1:1',
                projects: ['chrome'],
                annotations: [],
                titlePath: [id],
            },
        },
    ];
}

/** Each entry is what one getNextBatch call returns, or throws when it is an Error. */
function makeRunner(batches: (TestItem[] | Error)[], workers: number) {
    const queue = [...batches];
    const getNextBatch = vi.fn(() => {
        const next = queue.shift();
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    const reporter = { error: vi.fn(), warn: vi.fn() } as unknown as TestExecutionReporter;
    const runner = new TestRunner(
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        {} as any,
        () => ({ getNextBatch }),
        reporter,
        {} as any,
        {} as any,
    );
    const runs: Deferred[] = [];
    // Each batch finishes when the test resolves or rejects its deferred
    (runner as unknown as { runTestBatch: () => Promise<void> }).runTestBatch = () => {
        const run = defer();
        runs.push(run);
        return run.promise;
    };
    let settled = false;
    const run = () => {
        const result = ((runner as any).runBatches(makeConfig(workers), {}) as Promise<void>).finally(() => {
            settled = true;
        });
        // Observed here so a rejection is not reported as unhandled before the test awaits it
        result.catch(() => {});
        return result;
    };
    return { run, getNextBatch, reporter, runs, isSettled: () => settled };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('TestRunner.runBatches', () => {
    it('runs every batch and resolves when all succeed', async () => {
        const { run, getNextBatch, runs } = makeRunner([makeBatch('a'), makeBatch('b'), makeBatch('c')], 2);
        const result = run();
        await vi.waitFor(() => expect(runs).toHaveLength(2));
        runs[0].resolve();
        await vi.waitFor(() => expect(runs).toHaveLength(3));
        runs[1].resolve();
        runs[2].resolve();
        await expect(result).resolves.toBeUndefined();
        expect(getNextBatch).toHaveBeenCalledTimes(4);
    });

    it('waits for running batches after one fails and stops claiming new ones', async () => {
        const error = new Error('saveTestResult failed');
        const { run, getNextBatch, runs, isSettled } = makeRunner(
            ['a', 'b', 'c', 'd', 'e'].map((id) => makeBatch(id)),
            3,
        );
        const result = run();
        await vi.waitFor(() => expect(runs).toHaveLength(3));
        // The fourth batch is already claimed while waiting for a free worker
        expect(getNextBatch).toHaveBeenCalledTimes(4);

        runs[0].reject(error);
        // The claimed batch is off the queue, so it still runs
        await vi.waitFor(() => expect(runs).toHaveLength(4));
        await flush();
        expect(getNextBatch).toHaveBeenCalledTimes(4);
        expect(isSettled()).toBe(false);

        runs[1].resolve();
        runs[2].resolve();
        await flush();
        expect(isSettled()).toBe(false);

        runs[3].resolve();
        await expect(result).rejects.toBe(error);
        expect(runs).toHaveLength(4);
    });

    it('waits for running batches when claiming the next batch fails', async () => {
        const error = new Error('getNextTest failed');
        const { run, getNextBatch, runs, isSettled } = makeRunner([makeBatch('a'), error, makeBatch('b')], 2);
        const result = run();
        await vi.waitFor(() => expect(getNextBatch).toHaveBeenCalledTimes(2));
        await flush();
        expect(runs).toHaveLength(1);
        expect(isSettled()).toBe(false);

        runs[0].resolve();
        await expect(result).rejects.toBe(error);
        expect(getNextBatch).toHaveBeenCalledTimes(2);
    });

    it('throws the first error and reports the others', async () => {
        const first = new Error('first');
        const second = new Error('second');
        const { run, reporter, runs } = makeRunner([makeBatch('a'), makeBatch('b')], 2);
        const result = run();
        await vi.waitFor(() => expect(runs).toHaveLength(2));
        runs[0].reject(first);
        await flush();
        runs[1].reject(second);
        await expect(result).rejects.toBe(first);
        expect(reporter.error).toHaveBeenCalledTimes(1);
        expect(reporter.error).toHaveBeenCalledWith('Batch failed: second');
    });
});
