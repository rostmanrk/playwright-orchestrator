import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
const HEARTBEAT = { heartbeatInterval: 15_000, heartbeatTimeout: 60_000 };

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

        const handler = new FileShardHandler(
            { directory: dir },
            { runId: RUN_ID, shardId: 'shard', outputFolder: '', ...HEARTBEAT },
        );
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
                projects: [{ name: 'chrome', use: {}, repeatEach: 1, dependencies: [] }],
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
        const handler = new FileShardHandler(
            { directory: dir },
            { runId: RUN_ID, shardId: 'new', outputFolder: '', ...HEARTBEAT },
        );
        const config = await handler.startShard();
        return {
            config,
            queue: (await readJson<TestItem[]>(getRunIdFilePath(dir, RUN_ID))).map((test) => test.order),
            claimed: Object.keys(await readJson<ClaimedTests>(getClaimedRunPath(dir, RUN_ID))),
        };
    }

    function claimedBy(test: TestItem, shardId: string): TestItem {
        return { ...test, meta: { ...test.meta, shardId } };
    }

    it('records the claiming shard and moves its aliveUntil on each heartbeat', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
        await writeJson(getRunConfigPath(dir, RUN_ID), { ...makeRun({}), status: RunStatus.Created });
        // The shard of an earlier claim is replaced
        await writeJson(getRunIdFilePath(dir, RUN_ID), [makeTest(2), claimedBy(makeTest(1), 'earlier')]);
        await writeJson(getClaimedRunPath(dir, RUN_ID), {});
        const handler = new FileShardHandler(
            { directory: dir },
            { runId: RUN_ID, shardId: 'shard', outputFolder: '', ...HEARTBEAT },
        );
        const readShard = async () => (await readJson<TestRun>(getRunConfigPath(dir, RUN_ID))).shards.shard;

        await handler.startShard();
        expect(await readShard()).toEqual({
            shardId: 'shard',
            started: 1000,
            aliveUntil: 1000 + HEARTBEAT.heartbeatTimeout,
        });

        const test = await handler.getNextTest(makeRun({}).config);
        expect(test?.order).toBe(1);
        expect(await readJson<ClaimedTests>(getClaimedRunPath(dir, RUN_ID))).toEqual({
            [makeTest(1).testId]: claimedBy(makeTest(1), 'shard'),
        });

        now.mockReturnValue(5000);
        await handler.heartbeat();
        expect((await readShard()).aliveUntil).toBe(5000 + HEARTBEAT.heartbeatTimeout);
    });

    it('queues claims of dead shards and of an earlier process with the same id', async () => {
        const now = Date.now();
        const { queue, claimed, config } = await startRepeatRun(
            {
                // Killed: its heartbeat stopped
                killed: { shardId: 'killed', started: 0, aliveUntil: now - 1000 },
                // Finished the first run, but its id is running the repeat run
                reused: { shardId: 'reused', started: 0, finished: 1, aliveUntil: now + 60_000 },
            },
            {
                [makeTest(1).testId]: claimedBy(makeTest(1), 'killed'),
                [makeTest(2).testId]: claimedBy(makeTest(2), 'reused'),
                // Claimed by an earlier process with the starting shard's id
                [makeTest(3).testId]: claimedBy(makeTest(3), 'new'),
            },
        );

        expect(queue).toEqual([3, 1]);
        expect(claimed).toEqual([makeTest(2).testId]);
        expect(config.remainingCount).toBe(2);
    });
});

describe('FileShardHandler.startShard', () => {
    function makeHandler() {
        return new FileShardHandler(
            { directory: dir },
            { runId: RUN_ID, shardId: 'new', outputFolder: '', ...HEARTBEAT },
        );
    }

    async function writeFinishedRun() {
        await writeJson(getRunConfigPath(dir, RUN_ID), {
            status: RunStatus.Finished,
            updated: 0,
            shards: {},
            config: {
                workers: 1,
                projects: [],
                args: [],
                options: { batchMode: BatchMode.Off, grouping: Grouping.Test, historyWindow: 10 },
            },
        } satisfies TestRun);
        await writeJson(getRunIdFilePath(dir, RUN_ID), []);
        await writeJson(getResultsRunPath(dir, RUN_ID), [makeResult(makeTest(1), TestStatus.Failed)]);
    }

    it('starts a repeat run of a run that has no claimed file', async () => {
        await writeFinishedRun();
        await makeHandler().startShard();
        expect((await readJson<TestItem[]>(getRunIdFilePath(dir, RUN_ID))).map((test) => test.order)).toEqual([1]);
    });

    it.each([
        ['queue', 'claim tests', () => getRunIdFilePath(dir, RUN_ID)],
        ['results', 'save results', () => getResultsRunPath(dir, RUN_ID)],
    ])('waits for the %s lock, which shards still running hold while they %s', async (_lock, _action, lockFile) => {
        await writeFinishedRun();
        await writeJson(getClaimedRunPath(dir, RUN_ID), {});
        let started = false;
        let release!: () => void;
        const held = new Promise<void>((resolve) => (release = resolve));
        const locked = withLock(lockFile(), () => held);
        // Let the lock be taken first
        await new Promise((resolve) => setTimeout(resolve, 50));
        const starting = makeHandler()
            .startShard()
            .then(() => {
                started = true;
            });
        await new Promise((resolve) => setTimeout(resolve, 300));
        expect(started).toBe(false);
        release();
        await locked;
        await starting;
        expect(started).toBe(true);
    });

    it('does not queue a claim whose test already has a result, e.g. after a crash before the claim was removed', async () => {
        await writeFinishedRun();
        await writeJson(getResultsRunPath(dir, RUN_ID), [
            makeResult(makeTest(1), TestStatus.Failed),
            makeResult(makeTest(2), TestStatus.Passed),
        ]);
        const claimedBy = (test: TestItem) => ({ ...test, meta: { ...test.meta, shardId: 'new' } });
        await writeJson(getClaimedRunPath(dir, RUN_ID), {
            [makeTest(1).testId]: claimedBy(makeTest(1)),
            [makeTest(2).testId]: claimedBy(makeTest(2)),
            [makeTest(3).testId]: claimedBy(makeTest(3)),
        });
        await makeHandler().startShard();
        // Test 1 is queued once, as failed; test 2 passed; test 3 has no result
        expect((await readJson<TestItem[]>(getRunIdFilePath(dir, RUN_ID))).map((test) => test.order)).toEqual([3, 1]);
        expect(await readJson<ClaimedTests>(getClaimedRunPath(dir, RUN_ID))).toEqual({});
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
