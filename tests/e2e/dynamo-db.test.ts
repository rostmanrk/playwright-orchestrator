import { test, expect, afterAll, beforeAll } from 'vitest';
import { exec } from '../../e2e/test-utils.js';
import { rm } from 'node:fs/promises';

const reportsFolder = './test-reports-folder-dynamo';
const config = 'tests-playwright.config.ts';
const storageOptions = `dynamo-db --endpoint-url http://localhost:${process.env.CI ? '8000' : '8002'}`;

beforeAll(async () => {
    process.env.AWS_ACCESS_KEY_ID = 'local';
    process.env.AWS_SECRET_ACCESS_KEY = 'local';
    process.env.AWS_REGION = 'local';
    if (process.env.CI) return;
    await exec('npm run dynamo-local -- up test --wait');
});

afterAll(async () => {
    if (process.env.CI) return;
    await exec('npm run dynamo-local -- down test');
    await rm(reportsFolder, { recursive: true, force: true });
});

test('test dynamo-db plugin', async () => {
    // init command
    const init = await exec(`playwright-orchestrator init ${storageOptions}`);
    expect(init.stdout).toBeTruthy();

    // create command
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
