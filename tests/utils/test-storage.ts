import { expect } from 'vitest';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';

export async function testStorage(storageOptions: string[], config: string, reportsFolder: string) {
    // init command
    const init = await spawnAsync('pnpm', ['exec', 'playwright-orchestrator', 'init', ...storageOptions]);
    expect(init.stdout).toBeTruthy();

    // create command
    const create = await spawnAsync('pnpm', [
        'exec',
        'playwright-orchestrator',
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
    const command = ['exec', `playwright-orchestrator`, `run`, ...storageOptions, `--run-id`, runId, `--output`, reportsFolder];
    await Promise.all([spawnAsync('pnpm', command), spawnAsync('pnpm', command)]);
    const { stdout } = await spawnAsync('pnpm', [
        'exec',
        'playwright',
        'merge-reports',
        reportsFolder,
        '--reporter',
        'tests/utils/test-consistent-reporter.ts',
    ]);
    await expect(stdout).toMatchFileSnapshot('../__snapshots__/test-run.output.snap');
}
