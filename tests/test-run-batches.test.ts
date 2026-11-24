import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { TestRunner } from '../packages/core/src/runner/test-runner.js';
import type { TestItem, TestRunConfig, TestRunContext } from '../packages/core/src/types/adapters.js';
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

const HEARTBEAT_INTERVAL = 1000;
const HEARTBEAT_TIMEOUT = 4000;

/** Each entry is what one getNextBatch call returns, or throws when it is an Error. */
function makeRunner(batches: (TestItem[] | Error)[], workers: number) {
    const queue = [...batches];
    const getNextBatch = vi.fn(() => {
        const next = queue.shift();
        return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    });
    const reporter = { error: vi.fn(), warn: vi.fn() } as unknown as TestExecutionReporter;
    const heartbeat = vi.fn(() => Promise.resolve());
    const runContext: TestRunContext = {
        runId: 'run-id',
        shardId: 'shard',
        outputFolder: '',
        heartbeatInterval: HEARTBEAT_INTERVAL,
        heartbeatTimeout: HEARTBEAT_TIMEOUT,
    };
    const runner = new TestRunner(
        runContext,
        { heartbeat } as any,
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
    const startHeartbeat = () => (runner as unknown as { startHeartbeat: () => () => Promise<void> }).startHeartbeat();
    return { run, getNextBatch, heartbeat, startHeartbeat, reporter, runs, isSettled: () => settled };
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

describe('TestRunner heartbeat', () => {
    beforeEach(() => {
        vi.useFakeTimers({ now: 0 });
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('beats every interval until stopped, and waits for a beat in flight when stopped', async () => {
        const { heartbeat, startHeartbeat } = makeRunner([], 1);
        const stop = startHeartbeat();
        expect(heartbeat).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL);
        expect(heartbeat).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL);
        expect(heartbeat).toHaveBeenCalledTimes(2);

        const beat = defer();
        heartbeat.mockReturnValueOnce(beat.promise);
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL);
        let stopped = false;
        const stopping = stop().then(() => {
            stopped = true;
        });
        await vi.advanceTimersByTimeAsync(0);
        expect(stopped).toBe(false);
        beat.resolve();
        await stopping;

        await vi.advanceTimersByTimeAsync(5 * HEARTBEAT_INTERVAL);
        expect(heartbeat).toHaveBeenCalledTimes(3);
    });

    it('only warns when a heartbeat fails and keeps beating', async () => {
        const { heartbeat, startHeartbeat, reporter } = makeRunner([], 1);
        heartbeat.mockRejectedValueOnce(new Error('connection lost'));
        const stop = startHeartbeat();
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL);
        expect(reporter.warn).toHaveBeenCalledWith('Heartbeat failed: connection lost');
        await vi.advanceTimersByTimeAsync(HEARTBEAT_INTERVAL);
        expect(heartbeat).toHaveBeenCalledTimes(2);
        await stop();
    });
});
