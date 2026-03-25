import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaywrightTestEventHandler } from '../packages/core/src/runner/test-event-handler.js';
import type { TestItem, TestRunConfig } from '../packages/core/src/types/adapters.js';
import { Grouping, BatchMode } from '../packages/core/src/types/adapters.js';
import type { Adapter } from '../packages/core/src/adapters/adapter.js';
import { TestExecutionReporter } from '../packages/core/src/runner/test-execution-reporter.js';

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
        file: 'tests/foo.spec.ts',
        position: '5:1',
        projects: ['chrome'],
        order: 0,
        timeout: 5000,
        ema: 0,
    } as unknown as TestItem;
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
    vi.spyOn(reporter, 'addGroup').mockImplementation(() => {});
    const addTestSpy = vi.spyOn(reporter, 'addTest').mockImplementation(() => {});
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

        await onExit();
        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
    });
});
