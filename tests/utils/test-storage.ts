import { expect } from 'vitest';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');
const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');

export async function testStorage(storageOptions: string[], config: string, reportsFolder: string) {
    // init command
    const init = await spawnAsync(process.execPath, [orchestratorCli, 'init', ...storageOptions]);
    expect(init.stdout).toBeTruthy();

    // create command
    const create = await spawnAsync(process.execPath, [
        orchestratorCli,
        'create',
        ...storageOptions,
        '-j',
        '2',
        '--config',
        config,
    ]);
    const runId = create.stdout.trim();
    expect(runId).toBeTruthy();

    // run command
    const command = [orchestratorCli, 'run', ...storageOptions, '--run-id', runId, '--output', reportsFolder];
    await Promise.all([spawnAsync(process.execPath, command), spawnAsync(process.execPath, command)]);
    const { stdout } = await spawnAsync(process.execPath, [
        playwrightCli,
        'merge-reports',
        reportsFolder,
        '--reporter',
        'tests/utils/test-consistent-reporter.ts',
    ]);
    await expect(stdout).toMatchFileSnapshot('../__snapshots__/test-run.output.snap');
}
