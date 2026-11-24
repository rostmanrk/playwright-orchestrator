import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CLAIM_MARGIN } from '../packages/core/src/helpers/claim.js';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileShardHandler } from '../packages/file/src/file-shard-handler.js';
import { withLock } from '../packages/file/src/file-utils.js';
import {
    getClaimedRunPath,
    getResultsRunPath,
    getRunConfigPath,
    getRunIdFilePath,
} from '../packages/file/src/file-paths.js';
import type { ClaimedTests, ResultTestItem } from '../packages/file/src/types.js';
import { BatchMode, Grouping } from '../packages/core/src/types/adapters.js';
import type { TestItem, TestRun } from '../packages/core/src/types/adapters.js';
import { RunStatus, TestStatus } from '../packages/core/src/types/test-info.js';

const RUN_ID = 'run-id';

let dir: string;

function makeTest(order: number, ema = order * 1000): TestItem {
    return {
        testId: `a.spec.ts > test ${order}`,
        order,
        timeout: 5000,
        ema,
        meta: { file: 'a.spec.ts', position: `${order}:1`, projects: ['chrome'], annotations: [], titlePath: [] },
    };
}

function makeResult(test: TestItem, status: TestStatus): ResultTestItem {
    return { ...test, status, report: { duration: 1, ema: test.ema, fails: 0, title: test.testId } };
}

async function writeJson(file: string, data: unknown) {
    await writeFile(file, JSON.stringify(data));
}

async function readJson<T>(file: string): Promise<T> {
    return JSON.parse(await readFile(file, 'utf-8')) as T;
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'file-shard-handler-'));
});

afterEach(async () => {
    vi.restoreAllMocks();
    await rm(dir, { recursive: true, force: true });
});

describe('FileShardHandler repeat run', () => {
    it('queues failed tests together with tests the previous run never claimed', async () => {
        const testRun: TestRun = {
            status: RunStatus.Finished,
            updated: 0,
            shards: {},
            config: {
                workers: 1,
                projects: [],
                args: [],
                options: { batchMode: BatchMode.Off, grouping: Grouping.Test, historyWindow: 10 },
            },
        };
        await writeJson(getRunConfigPath(dir, RUN_ID), testRun);
        // The previous run was interrupted before it claimed tests 4 and 5
        await writeJson(getRunIdFilePath(dir, RUN_ID), [makeTest(5), makeTest(4)]);
        await writeJson(getResultsRunPath(dir, RUN_ID), [
            makeResult(makeTest(3), TestStatus.Failed),
            makeResult(makeTest(2), TestStatus.Passed),
            makeResult(makeTest(1), TestStatus.Failed),
        ]);
        await writeJson(getClaimedRunPath(dir, RUN_ID), {});

        const handler = new FileShardHandler({ directory: dir }, { runId: RUN_ID, shardId: 'shard', outputFolder: '' });
        const config = await handler.startShard();

        const queue = await readJson<TestItem[]>(getRunIdFilePath(dir, RUN_ID));
        // Tests are popped from the end, so the lowest order runs first
        expect(queue.map((test) => test.order)).toEqual([5, 4, 3, 1]);
        expect(queue.every((test) => !('status' in test))).toBe(true);
        const results = await readJson<ResultTestItem[]>(getResultsRunPath(dir, RUN_ID));
        expect(results.map((test) => test.order)).toEqual([2]);
        expect(config.remainingCount).toBe(4);
        expect(config.remainingTime).toBe(13_000);
        expect((await readJson<TestRun>(getRunConfigPath(dir, RUN_ID))).status).toBe(RunStatus.RepeatRun);
    });
});

describe('FileShardHandler claimed tests', () => {
    function makeRun(shards: TestRun['shards']): TestRun {
        return {
            status: RunStatus.Finished,
            updated: 0,
            shards,
            config: {
                workers: 1,
                projects: [{ name: 'chrome', use: {}, repeatEach: 1, retries: 0, dependencies: [] }],
                args: [],
                options: { batchMode: BatchMode.Off, grouping: Grouping.Test, historyWindow: 10 },
            },
        };
    }

    async function startRepeatRun(shards: TestRun['shards'], claimed: ClaimedTests) {
        await writeJson(getRunConfigPath(dir, RUN_ID), makeRun(shards));
        await writeJson(getRunIdFilePath(dir, RUN_ID), []);
        await writeJson(getResultsRunPath(dir, RUN_ID), []);
        await writeJson(getClaimedRunPath(dir, RUN_ID), claimed);
        const handler = new FileShardHandler({ directory: dir }, { runId: RUN_ID, shardId: 'new', outputFolder: '' });
        const config = await handler.startShard();
        return {
            config,
            queue: (await readJson<TestItem[]>(getRunIdFilePath(dir, RUN_ID))).map((test) => test.order),
            claimed: Object.keys(await readJson<ClaimedTests>(getClaimedRunPath(dir, RUN_ID))),
        };
    }

    function withDeadline(test: TestItem, deadline?: number): TestItem {
        return { ...test, meta: { ...test.meta, deadline } };
    }

    it('records a claim with the claim deadline, then the batch deadline or none', async () => {
        vi.spyOn(Date, 'now').mockReturnValue(1000);
        await writeJson(getRunConfigPath(dir, RUN_ID), makeRun({}));
        // The deadline from an earlier claim is replaced
        await writeJson(getRunIdFilePath(dir, RUN_ID), [makeTest(2), withDeadline(makeTest(1), 1)]);
        await writeJson(getClaimedRunPath(dir, RUN_ID), {});
        const handler = new FileShardHandler({ directory: dir }, { runId: RUN_ID, shardId: 'shard', outputFolder: '' });
        const readClaimed = () => readJson<ClaimedTests>(getClaimedRunPath(dir, RUN_ID));

        const test = await handler.getNextTest(makeRun({}).config);
        expect(test?.order).toBe(1);
        expect(await readClaimed()).toEqual({ [makeTest(1).testId]: withDeadline(makeTest(1), 1000 + CLAIM_MARGIN) });

        await handler.setClaimDeadline([test!], 1234);
        expect(await readClaimed()).toEqual({ [makeTest(1).testId]: withDeadline(makeTest(1), 1234) });

        await handler.setClaimDeadline([test!], null);
        expect(await readClaimed()).toEqual({ [makeTest(1).testId]: makeTest(1) });
    });

    it('queues claims of a shard that was killed once their deadline has passed', async () => {
        const now = Date.now();
        const { queue, claimed, config } = await startRepeatRun(
            // The killed shard never finished
            { killed: { shardId: 'killed', started: 0 } },
            {
                [makeTest(1).testId]: withDeadline(makeTest(1), now - 1000),
                // Could still be running
                [makeTest(2).testId]: withDeadline(makeTest(2), now + 60_000),
                // A test in its batch had no timeout, so there is no way to tell
                [makeTest(3).testId]: makeTest(3),
            },
        );

        expect(queue).toEqual([1]);
        expect(claimed).toEqual([makeTest(2).testId, makeTest(3).testId]);
        expect(config.remainingCount).toBe(1);
    });

    it('queues every claim when every other shard has finished', async () => {
        const { queue, claimed } = await startRepeatRun(
            { done: { shardId: 'done', started: 0, finished: 1 } },
            {
                [makeTest(1).testId]: withDeadline(makeTest(1), Date.now() + 60_000),
                [makeTest(2).testId]: makeTest(2),
            },
        );

        expect(queue).toEqual([2, 1]);
        expect(claimed).toEqual([]);
    });
});

describe('withLock', () => {
    it('hands a contended lock over quickly', async () => {
        const file = join(dir, 'locked.json');
        await writeFile(file, '');
        const start = Date.now();
        await Promise.all(Array.from({ length: 20 }, () => withLock(file, () => Promise.resolve())));
        // With the default 1s backoff, 20 contenders took many seconds
        expect(Date.now() - start).toBeLessThan(2000);
    });
});
