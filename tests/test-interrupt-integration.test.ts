import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnAsync } from '../packages/core/src/helpers/spawn.js';
import { RunStatus, TestStatus } from '../packages/core/src/types/test-info.js';
import type { TestRun } from '../packages/core/src/types/adapters.js';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');
const config = 'e2e/interrupt/playwright.config.ts';

let dir: string;

function isRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

async function waitFor(condition: () => boolean, timeout: number) {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'interrupt-'));
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe.each([
    ['SIGTERM', 143],
    ['SIGINT', 130],
] as const)('%s while tests run', (signal, expectedExitCode) => {
    it('stops Playwright, saves the interrupted test as failed and finishes the shard', async () => {
        const storage = join(dir, signal);
        const marker = join(dir, `${signal}.marker.json`);
        const create = await spawnAsync(process.execPath, [
            orchestratorCli,
            'create',
            'file',
            '--directory',
            storage,
            '--config',
            config,
        ]);
        const runId = create.stdout.trim();
        expect(runId, `create failed: ${create.stderr}`).toBeTruthy();

        // Only the orchestrator gets the signal, as with `kill <pid>` or a container stop
        const run = spawn(
            process.execPath,
            [orchestratorCli, 'run', 'file', '--directory', storage, '--run-id', runId, '--output', join(dir, 'blob')],
            { env: { ...process.env, INTERRUPT_MARKER: marker }, stdio: 'ignore' },
        );
        const exited = new Promise<number | null>((resolve) => run.on('close', resolve));
        await waitFor(() => existsSync(marker), 30_000);
        const { worker, runner } = JSON.parse(await readFile(marker, 'utf-8')) as { worker: number; runner: number };

        run.kill(signal);

        expect(await exited).toBe(expectedExitCode);
        expect(isRunning(runner)).toBe(false);
        await waitFor(() => !isRunning(worker), 5_000);

        const testRun = JSON.parse(await readFile(join(storage, `${runId}.config.json`), 'utf-8')) as TestRun;
        expect(testRun.status).toBe(RunStatus.Finished);
        expect(Object.values(testRun.shards).every((shard) => shard.finished)).toBe(true);

        const results = JSON.parse(await readFile(join(storage, `${runId}.results.json`), 'utf-8')) as {
            testId: string;
            status: TestStatus;
        }[];
        expect(results).toEqual([
            expect.objectContaining({ testId: 'interrupt.spec.ts > waits for interrupt', status: TestStatus.Failed }),
        ]);
    }, 60_000);
});
