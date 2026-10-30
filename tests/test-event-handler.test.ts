import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PlaywrightTestEventHandler } from '../packages/core/src/runner/test-event-handler.js';
import type { TestItem, TestRunConfig } from '../packages/core/src/types/adapters.js';
import { Grouping, BatchMode } from '../packages/core/src/types/adapters.js';
import type { Adapter } from '../packages/core/src/adapters/adapter.js';
import { TestExecutionReporter } from '../packages/core/src/runner/test-execution-reporter.js';
import { TestStatus } from '../packages/core/src/types/test-info.js';

function makeConfig(repeatEach = 1, projects = ['chrome'], grouping: Grouping = Grouping.Project): TestRunConfig {
    return {
        workers: 1,
        projects: projects.map((name) => ({ name, use: {}, repeatEach, dependencies: [] })),
        args: [],
        options: {
            batchMode: BatchMode.Off,
            grouping,
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
            file: 'tests/foo.spec.ts',
            position: '5:1',
            projects: ['chrome'],
            annotations: [],
            titlePath: [id],
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
    project = 'chrome',
    status: string = ok ? 'passed' : 'failed',
) {
    return {
        type,
        project,
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
            status,
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
    const handler = new PlaywrightTestEventHandler(
        { runId: 'run-id', shardId: 'shard', outputFolder: '' },
        adapter,
        reporter,
    );
    return { handler, adapter, reporter, addTestSpy };
}

/** The promise the reporter uses to show the group as passed or failed in the shard summary. */
function groupOutcome(reporter: TestExecutionReporter, testId: string): Promise<unknown> {
    const call = vi.mocked(reporter.addGroup).mock.calls.find(([, test]) => test.testId === testId);
    return call![2];
}

/** Sends a begin + end pair for one Playwright test result. */
function report(onData: (data: any, isError: boolean) => void, ...args: Parameters<typeof makeEvent>) {
    const [testId, title, repeatEachIndex, retry, retries, ok, , project, status] = args;
    onData(JSON.stringify(makeEvent(testId, title, repeatEachIndex, retry, retries, ok, 'begin', project)), false);
    onData(
        JSON.stringify(makeEvent(testId, title, repeatEachIndex, retry, retries, ok, 'end', project, status)),
        false,
    );
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
        onData(JSON.stringify(makeEvent('foo', 'foo', 0, 0, 0, true, 'begin')), false);
        onData(JSON.stringify(makeEvent('foo', 'foo', 0, 0, 0, true)), false);
        // repeat 1
        onData(JSON.stringify(makeEvent('foo', 'foo', 1, 0, 0, true, 'begin')), false);
        onData(JSON.stringify(makeEvent('foo', 'foo', 1, 0, 0, true)), false);

        expect(addTestSpy).toHaveBeenCalledTimes(2);
        const displayNames = addTestSpy.mock.calls.map(([_test, _subId, displayName]) => displayName);
        expect(displayNames[0]).not.toContain('repeat');
        expect(displayNames[1]).toContain('2/2');
    });

    it('calls updateTestWithResults once after all repeat runs finish', async () => {
        const { handler, adapter } = makeHandler();
        const test = makeTestItem('bar');
        const { onData, onExit } = handler.init([test], makeConfig(2), 'Batch 1');

        onData(JSON.stringify(makeEvent('bar', 'bar', 0, 0, 0, true, 'begin')), false);
        onData(JSON.stringify(makeEvent('bar', 'bar', 0, 0, 0, true)), false);
        onData(JSON.stringify(makeEvent('bar', 'bar', 1, 0, 0, true, 'begin')), false);
        onData(JSON.stringify(makeEvent('bar', 'bar', 1, 0, 0, true)), false);

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
        onData(JSON.stringify(makeEvent('partial', 'partial', 0, 0, 0, true, 'begin')), false);
        onData(JSON.stringify(makeEvent('partial', 'partial', 0, 0, 0, true)), false);

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

        onData(JSON.stringify(makeEvent('done', 'done', 0, 0, 0, true, 'begin')), false);
        onData(JSON.stringify(makeEvent('done', 'done', 0, 0, 0, true)), false);

        const allReported = await onExit(0);

        expect(allReported).toBe(true);
        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(TestStatus.Passed, expect.anything());
        expect(errorSpy).not.toHaveBeenCalled();
    });
});

describe('PlaywrightTestEventHandler — status', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    function makeSerialGroup(): TestItem {
        return { ...makeTestItem('#serial'), meta: { ...makeTestItem('#serial').meta, children: ['first', 'second'] } };
    }
    const firstId = '[chrome] tests/foo.spec.ts > first';
    const secondId = '[chrome] tests/foo.spec.ts > second';

    it('fails a test that failed in one project even if another project reported last and passed', async () => {
        const { handler, adapter, reporter } = makeHandler();
        const test = {
            ...makeTestItem('multi'),
            meta: { ...makeTestItem('multi').meta, projects: ['chrome', 'firefox'] },
        };
        const { onData, onExit } = handler.init([test], makeConfig(1, ['chrome', 'firefox'], Grouping.Test), 'Batch 1');

        report(onData, 'multi', 'multi', 0, 0, 0, false, 'end', 'firefox');
        report(onData, 'multi', 'multi', 0, 0, 0, true, 'end', 'chrome');
        await onExit(1);

        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(TestStatus.Failed, expect.anything());
        await expect(groupOutcome(reporter, 'multi')).rejects.toBeUndefined();
    });

    it('fails a serial group whose remaining tests were skipped after a failure', async () => {
        const { handler, adapter, reporter } = makeHandler();
        const test = makeSerialGroup();
        const { onData, onExit } = handler.init([test], makeConfig(), 'Batch 1');

        // Playwright reports the tests skipped after a serial failure with ok() === true
        report(onData, firstId, 'first', 0, 0, 0, false);
        report(onData, secondId, 'second', 0, 0, 0, true, 'end', 'chrome', 'skipped');
        await onExit(1);

        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(TestStatus.Failed, expect.anything());
        await expect(groupOutcome(reporter, '#serial')).rejects.toBeUndefined();
    });

    it('passes a serial group whose retry passed, waiting for the retry before saving', async () => {
        const { handler, adapter, reporter } = makeHandler();
        const test = makeSerialGroup();
        const { onData, onExit } = handler.init([test], makeConfig(), 'Batch 1');

        report(onData, firstId, 'first', 0, 0, 1, false);
        report(onData, secondId, 'second', 0, 0, 1, true, 'end', 'chrome', 'skipped');
        expect(adapter.updateTestWithResults).not.toHaveBeenCalled();
        report(onData, firstId, 'first', 0, 1, 1, true);
        report(onData, secondId, 'second', 0, 1, 1, true);
        await onExit(0);

        expect(adapter.updateTestWithResults).toHaveBeenCalledTimes(1);
        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(
            TestStatus.Passed,
            expect.objectContaining({ testResult: expect.objectContaining({ duration: 400 }) }),
        );
        await expect(groupOutcome(reporter, '#serial')).resolves.toBeUndefined();
    });

    it('passes a test when at least one repeat passed', async () => {
        const { handler, adapter } = makeHandler();
        const test = makeTestItem('flaky');
        const { onData, onExit } = handler.init([test], makeConfig(2), 'Batch 1');

        report(onData, 'flaky', 'flaky', 0, 0, 0, false);
        report(onData, 'flaky', 'flaky', 1, 0, 0, true);
        await onExit(0);

        expect(adapter.updateTestWithResults).toHaveBeenCalledWith(TestStatus.Passed, expect.anything());
    });
});
