import { expect } from 'vitest';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import type { TestRunReport } from '../../packages/core/src/types/reporter.js';
import { TestStatus } from '../../packages/core/src/types/test-info.js';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');
const shiftClock = pathToFileURL(resolve('tests/utils/shift-clock.mjs')).href;
const HOUR = 60 * 60 * 1000;
const fixtureFolder = 'e2e/abandoned';

async function waitFor(condition: () => boolean, timeout: number) {
    const deadline = Date.now() + timeout;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
}

function kill(pid: number) {
    try {
        process.kill(pid, 'SIGKILL');
    } catch {
        // Already exited
    }
}

/**
 * A shard is killed while running a test, so the test stays claimed without a result. Another shard finishes
 * the run, and a repeat run, an hour later by its clock, queues the abandoned test again and runs it.
 */
export async function testAbandonedClaims(storageOptions: string[]) {
    const dir = await mkdtemp(join(tmpdir(), 'abandoned-'));
    try {
        const init = await spawnAsync(process.execPath, [orchestratorCli, 'init', ...storageOptions]);
        expect(init.code, `init failed: ${init.stderr}`).toBe(0);
        const create = await spawnAsync(process.execPath, [
            orchestratorCli,
            'create',
            ...storageOptions,
            '--config',
            `${fixtureFolder}/playwright.config.ts`,
        ]);
        const runId = create.stdout.trim();
        expect(runId, `create failed: ${create.stderr}`).toBeTruthy();
        const run = (...args: string[]) => [
            orchestratorCli,
            'run',
            ...storageOptions,
            '--run-id',
            runId,
            '--output',
            join(dir, 'blob'),
            ...args,
        ];

        const marker = join(dir, 'marker.json');
        const killed = spawn(process.execPath, run('--shard-id', 'killed'), {
            env: { ...process.env, ABANDONED_MARKER: marker },
            stdio: 'ignore',
        });
        const exited = new Promise((resolve) => killed.on('close', resolve));
        await waitFor(() => existsSync(marker), 60_000);
        const { worker, runner } = JSON.parse(await readFile(marker, 'utf-8')) as { worker: number; runner: number };
        // As with an OOM kill or a lost node: nothing gets to clean up or save results
        killed.kill('SIGKILL');
        kill(runner);
        kill(worker);
        await exited;

        const finishing = await spawnAsync(process.execPath, run('--shard-id', 'finishing'));
        expect(finishing.code, `finishing shard failed: ${finishing.stderr}`).toBe(0);

        const repeat = await spawnAsync(process.execPath, run('--shard-id', 'repeat'), {
            env: { ...process.env, NODE_OPTIONS: `--import ${shiftClock}`, CLOCK_OFFSET_MS: String(HOUR) },
        });
        expect(repeat.code, `repeat run failed: ${repeat.stderr}`).toBe(0);

        const report = await spawnAsync(process.execPath, [
            orchestratorCli,
            'create-report',
            ...storageOptions,
            '--reporter',
            'json',
            '--run-id',
            runId,
        ]);
        const { tests } = JSON.parse(report.stdout) as TestRunReport;
        expect(tests.map(({ title, status }) => ({ title, status }))).toEqual([
            { title: 'abandoned.spec.ts > runs again after its shard is killed', status: TestStatus.Passed },
        ]);
    } finally {
        await rm(dir, { recursive: true, force: true });
        // The killed shard had no chance to remove its temporary Playwright config
        for (const file of await readdir(fixtureFolder)) {
            if (file.endsWith('.config.tmp.ts')) await rm(join(fixtureFolder, file), { force: true });
        }
    }
}
