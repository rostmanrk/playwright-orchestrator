import { test, expect } from 'vitest';
import { promisify } from 'node:util';
import * as child_process from 'node:child_process';

const exec = promisify(child_process.exec);

test('test analyzer command', async () => {
    const commandResult = await exec(
        'npx playwright test --list -g @analyzer --reporter "@playwright-orchestrator/core/tests-info-reporter"',
    );
    if (commandResult.stderr) {
        expect.fail(commandResult.stderr);
    }
    expect(commandResult.stdout).toMatchSnapshot();
});
