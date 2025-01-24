import { test, expect, afterAll } from 'vitest';
import { exec } from '../../e2e/test-utils';
import { rm } from 'fs/promises';

const filesFolder = 'test-runs-folder';
const reportsFolder = './test-reports-folder';
const config = 'tests-playwright.config.ts';
const storageOptions = `file --directory ${filesFolder}`;

afterAll(async () => {
    if (process.env.CI) return;
    await rm(filesFolder, { recursive: true, force: true });
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test file plugin', async () => {
    // init command
    const init = await exec(`playwright-orchestrator init ${storageOptions}`);
    expect(init.stdout).toBeTruthy();

    // create command
    await rm(filesFolder, { recursive: true, force: true });
    const create = await exec(`playwright-orchestrator create ${storageOptions} -j 2 --config ${config}`);
    const runId = create.stdout.trim();
    expect(runId).toBeTruthy();

    // run command
    const command = `playwright-orchestrator run ${storageOptions} --run-id ${runId} --output ${reportsFolder}`;
    await Promise.all([exec(command), exec(command)]);
    const { stdout } = await exec(
        `npx playwright merge-reports ${reportsFolder} --reporter tests/utils/test-consistent-reporter.ts`,
    );
    await expect(stdout).toMatchFileSnapshot('../__snapshots__/test-run.output.snap');
}, 60000);
