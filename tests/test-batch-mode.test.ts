import { test, expect } from 'vitest';
import { spawnAsync } from '../packages/core/src/helpers/spawn.js';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');

async function createWithArgs(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return spawnAsync(process.execPath, [orchestratorCli, 'create', 'file', ...args], {
        env: {
            ...process.env,
            VSCODE_INSPECTOR_OPTIONS: undefined,
        },
    }).catch((e) => e);
}

test('batch-mode time without batch-target fails with required error', async () => {
    const result = await createWithArgs(['--batch-mode', 'time']);
    expect(result.stderr).toContain("--batch-target is required when --batch-mode is 'time'");
}, 30000);

test('batch-mode count without batch-target fails with required error', async () => {
    const result = await createWithArgs(['--batch-mode', 'count']);
    expect(result.stderr).toContain("--batch-target is required when --batch-mode is 'count'");
}, 30000);

test('batch-mode time with batch-target succeeds and returns a run id', async () => {
    const result = await createWithArgs(['--batch-mode', 'time', '--batch-target', '30']);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toMatch(/^[0-9a-f-]{36}$/);
}, 30000);

test('batch-mode count with batch-target succeeds and returns a run id', async () => {
    const result = await createWithArgs(['--batch-mode', 'count', '--batch-target', '5']);
    expect(result.stderr).toBe('');
    expect(result.stdout.trim()).toMatch(/^[0-9a-f-]{36}$/);
}, 30000);
