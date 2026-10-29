import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaywrightTestEventHandler } from '../packages/core/src/runner/test-event-handler.js';
import type { TestItem, TestRunConfig } from '../packages/core/src/types/adapters.js';
import { Grouping, BatchMode } from '../packages/core/src/types/adapters.js';
import type { Adapter } from '../packages/core/src/adapters/adapter.js';
import { TestExecutionReporter } from '../packages/core/src/runner/test-execution-reporter.js';
import { TestStatus } from '../packages/core/src/types/test-info.js';

function makeConfig(repeatEach = 1): TestRunConfig {
    return {
        workers: 1,
        projects: [{ name: 'chrome', use: {}, repeatEach }],
        args: [],
        options: {
            batchMode: BatchMode.Off,
            grouping: Grouping.Project,
            historyWindow: 10,
            batchTarget: 3,
        },
    };
}

function makeTestItem(id: string): TestItem {
    return {
        testId: id,
        order: 0,
        timeout: 5000,
        ema: 0,
        meta: {
            title: id,
            file: 'tests/foo.spec.ts',
            position: '5:1',
            projects: ['chrome'],
            annotations: [],
        },
    };
}

function makeEvent(
    testId: string,
    title: string,
    repeatEachIndex: number,
    retry: number,
    retries: number,
    ok: boolean,
    type: 'begin' | 'end' = 'end',
) {
    return {
        type,
        project: 'chrome',
        test: {
            testId,
            title,
            repeatEachIndex,
            retries,
            ok,
            annotations: [],
            tags: [],
            timeout: 5000,
            location: { line: 5, column: 1 },
        },
        result: {
            duration: 100,
            status: ok ? 'passed' : 'failed',
            retry,
            error: undefined,
        },
    } as any;
}

function makeHandler() {
    const adapter = { updateTestWithResults: vi.fn().mockResolvedValue(undefined) } as unknown as Adapter;
    const reporter = new TestExecutionReporter();
    vi.spyOn(reporter, 'addBatch').mockImplementation(() => {});
    // Like the real reporter, observe the promises so failed tests don't surface as unhandled rejections
    vi.spyOn(reporter, 'addGroup').mockImplementation((_batchName, _test, run) => void run.catch(() => {}));
    const addTestSpy = vi
        .spyOn(reporter, 'addTest')
        .mockImplementation((_test, _subId, _displayName, run) => void run.catch(() => {}));
    const handler = new PlaywrightTestEventHandler('run-id', adapter, reporter);
    return { handler, adapter, reporter, addTestSpy };
}

describe('PlaywrightTestEventHandler — repeatEach', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('creates a separate subTest entry for each repeat run', () => {
        const { handler, addTestSpy } = makeHandler();
        const test = makeTestItem('foo');
        const { onData } = handler.init([test], makeConfig(2), 'Batch 1');

        // repeat 0
        onData(JSON.stringify(makeEvent('foo', 'foo', 0, 0, 0, true, 'begin')));
        onData(JSON.stringify(makeEvent('foo', 'foo', 0, 0, 0, true)));
        // repeat 1
        onData(JSON.stringify(makeEvent('foo', 'foo', 1, 0, 0, true, 'begin')));
        onData(JSON.stringify(makeEvent('foo', 'foo', 1, 0, 0, true)));

        expect(addTestSpy).toHaveBeenCalledTimes(2);
        const displayNames = addTestSpy.mock.calls.map(([_test, _subId, displayName]) => displayName);
        expect(displayNames[0]).not.toContain('repeat');
        expect(displayNames[1]).toContain('2/2');
    });

    it('calls updateTestWithResults once after all repeat runs finish', async () => {
        const { handler, adapter } = makeHandler();
        const test = makeTestItem('bar');
        const { onData, onExit } = handler.init([test], makeConfig(2), 'Batch 1');

        onData(JSON.stringify(makeEvent('bar', 'bar', 0, 0, 0, true, 'begin')));
        onData(JSON.stringify(makeEvent('bar', 'bar', 0, 0, 0, true)));
        onData(JSON.stringify(makeEvent('bar', 'bar', 1, 0, 0, true, 'begin')));
        onData(JSON.stringify(makeEvent('bar', 'bar', 1, 0, 0, true)));

        await onExit(0);
        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
    });
});

describe('PlaywrightTestEventHandler — unreported tests', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('saves a test that never reported as failed, using its scheduled ema as duration', async () => {
        const { handler, adapter, reporter } = makeHandler();
        vi.spyOn(reporter, 'error').mockImplementation(() => {});
        const test = { ...makeTestItem('crashed'), ema: 1234 };
        const { onExit } = handler.init([test], makeConfig(), 'Batch 1');

        const allReported = await onExit(1);

        expect(allReported).toBe(false);
        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(
            TestStatus.Failed,
            expect.objectContaining({ test, testResult: { duration: 1234, tests: [] } }),
        );
        expect(reporter.error).toHaveBeenCalledWith(expect.stringContaining('crashed'));
    });

    it('saves a partially reported test as failed even if its reported runs passed', async () => {
        const { handler, adapter, reporter } = makeHandler();
        vi.spyOn(reporter, 'error').mockImplementation(() => {});
        const test = makeTestItem('partial');
        const { onData, onExit } = handler.init([test], makeConfig(2), 'Batch 1');

        // Only repeat 0 of 2 reports before Playwright exits
        onData(JSON.stringify(makeEvent('partial', 'partial', 0, 0, 0, true, 'begin')));
        onData(JSON.stringify(makeEvent('partial', 'partial', 0, 0, 0, true)));

        const allReported = await onExit(1);

        expect(allReported).toBe(false);
        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(
            TestStatus.Failed,
            expect.objectContaining({ testResult: expect.objectContaining({ duration: 100 }) }),
        );
    });

    it('does not save fully reported tests twice', async () => {
        const { handler, adapter, reporter } = makeHandler();
        const errorSpy = vi.spyOn(reporter, 'error').mockImplementation(() => {});
        const test = makeTestItem('done');
        const { onData, onExit } = handler.init([test], makeConfig(), 'Batch 1');

        onData(JSON.stringify(makeEvent('done', 'done', 0, 0, 0, true, 'begin')));
        onData(JSON.stringify(makeEvent('done', 'done', 0, 0, 0, true)));

        const allReported = await onExit(0);

        expect(allReported).toBe(true);
        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(TestStatus.Passed, expect.anything());
        expect(errorSpy).not.toHaveBeenCalled();
    });
});
