import { describe, it, expect, afterAll } from 'vitest';
import { spawnAsync } from '../packages/core/src/helpers/spawn.js';
import { createRequire } from 'node:module';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { TestItem } from '../packages/core/src/types/adapters.js';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');

const testDir = 'test-serial-detection-runs';

afterAll(async () => {
    await rm(testDir, { recursive: true, force: true });
});

describe('serial detection integration', () => {
    let queue: TestItem[];

    it('creates a run with file storage', async () => {
        const init = await spawnAsync(process.execPath, [orchestratorCli, 'init', 'file', '--directory', testDir]);
        expect(init.stdout, `init failed: ${init.stderr}`).toBeTruthy();

        const create = await spawnAsync(process.execPath, [
            orchestratorCli,
            'create',
            'file',
            '--directory',
            testDir,
            '--config',
            'tests-playwright.config.ts',
        ]);
        const runId = create.stdout.trim();
        expect(runId, `create failed: ${create.stderr}`).toBeTruthy();

        const raw = await readFile(join(testDir, `${runId}.queue.json`), 'utf-8');
        queue = JSON.parse(raw) as TestItem[];
        expect(queue.length).toBeGreaterThan(0);
    }, 30_000);

    it('groups nested serial suite into a single test item with children', () => {
        const serialItem = queue.find((t) => t.file === 'serial.spec.ts' && t.children !== undefined);
        expect(serialItem).toBeDefined();
        expect(serialItem!.children!.length).toBe(2);
    });

    it('groups file-level serial suite into a single test item with children', () => {
        const topLevelItem = queue.find((t) => t.file === 'serial-top-level.spec.ts' && t.children !== undefined);
        expect(topLevelItem).toBeDefined();
        expect(topLevelItem!.children!.length).toBe(2);
    });

    it('does not add children to non-serial tests', () => {
        const basicTests = queue.filter((t) => t.file === 'basic-case.spec.ts');
        expect(basicTests.length).toBeGreaterThan(0);
        expect(basicTests.every((t) => t.children === undefined)).toBe(true);
    });

    it('sums child timeouts for serial suite items', () => {
        const serialItem = queue.find((t) => t.file === 'serial.spec.ts' && t.children !== undefined);
        expect(serialItem).toBeDefined();
        // two children × 30s default timeout (test.setTimeout is runtime-only, not visible at --list time)
        expect(serialItem!.timeout).toBe(60_000);
    });
});
