import { expect } from 'vitest';
import { exec } from '../../e2e/test-utils.js';

export async function testStorage(storageOptions: string, config: string, reportsFolder: string) {
    // init command
    console.log(`Start time: ${new Date().toISOString()}`);
    const init = await exec(`playwright-orchestrator init ${storageOptions}`);
    console.log(`Inited time: ${new Date().toISOString()}`);
    expect(init.stdout).toBeTruthy();

    // create command
    const create = await exec(`playwright-orchestrator create ${storageOptions} -j 2 --config ${config}`);
    console.log(`Created time: ${new Date().toISOString()}`);
    const runId = create.stdout.trim();
    expect(runId).toBeTruthy();

    // run command
    const command = `playwright-orchestrator run ${storageOptions} --run-id ${runId} --output ${reportsFolder}`;
    await Promise.all([exec(command), exec(command)]);
    console.log(`Finished time: ${new Date().toISOString()}`);
    const { stdout } = await exec(
        `npx playwright merge-reports ${reportsFolder} --reporter tests/utils/test-consistent-reporter.ts`,
    );
    console.log(`Merged time: ${new Date().toISOString()}`);
    await expect(stdout).toMatchFileSnapshot('../__snapshots__/test-run.output.snap');
}
