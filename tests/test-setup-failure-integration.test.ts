import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnAsync } from '../packages/core/src/helpers/spawn.js';
import { RunStatus } from '../packages/core/src/types/test-info.js';
import type { TestRun } from '../packages/core/src/types/adapters.js';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');
const config = 'e2e/setup-failure/playwright.config.ts';

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'setup-failure-'));
});

afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('global setup failure', () => {
    it('runs global teardown and finishes the shard', async () => {
        const storage = join(dir, 'storage');
        const marker = join(dir, 'teardown.marker');
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

        const run = await spawnAsync(
            process.execPath,
            [orchestratorCli, 'run', 'file', '--directory', storage, '--run-id', runId, '--output', join(dir, 'blob')],
            { env: { ...process.env, TEARDOWN_MARKER: marker } },
        );

        expect(run.stderr).toContain('global setup failed');
        expect(existsSync(marker)).toBe(true);
        const testRun = JSON.parse(await readFile(join(storage, `${runId}.config.json`), 'utf-8')) as TestRun;
        expect(testRun.status).toBe(RunStatus.Finished);
        expect(Object.values(testRun.shards).every((shard) => shard.finished)).toBe(true);
    }, 60_000);
});
