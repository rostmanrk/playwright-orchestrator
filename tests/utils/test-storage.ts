import { expect } from 'vitest';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';

export async function testStorage(storageOptions: string[], config: string, reportsFolder: string) {
    // init command
    const init = await spawnAsync('npx', ['playwright-orchestrator', 'init', ...storageOptions]);
    expect(init.stdout).toBeTruthy();

    // create command
    const create = await spawnAsync('npx', [
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
    const command = [`playwright-orchestrator`, `run`, ...storageOptions, `--run-id`, runId, `--output`, reportsFolder];
    await Promise.all([spawnAsync('npx', command), spawnAsync('npx', command)]);
    const { stdout } = await spawnAsync('npx', [
        'playwright',
        'merge-reports',
        reportsFolder,
        '--reporter',
        'tests/utils/test-consistent-reporter.ts',
    ]);
    await expect(stdout).toMatchFileSnapshot('../__snapshots__/test-run.output.snap');
}
