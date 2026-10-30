import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileShardHandler } from '../packages/file/src/file-shard-handler.js';
import { withLock } from '../packages/file/src/file-utils.js';
import { getResultsRunPath, getRunConfigPath, getRunIdFilePath } from '../packages/file/src/file-paths.js';
import type { ResultTestItem } from '../packages/file/src/types.js';
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
