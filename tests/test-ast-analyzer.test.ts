import { test, expect } from 'vitest';
import { promisify } from 'node:util';
import child_process from 'node:child_process';
import { TestRunInfo } from '@playwright-orchestrator/core';
import path from 'node:path';

const exec = promisify(child_process.exec);

test('test custom info reporter', async () => {
    const commandResult = await exec(
        'npx playwright test --list --reporter "@playwright-orchestrator/core/tests-info-reporter" -j 2',
    );
    const testRunInfo = JSON.parse(commandResult.stdout) as TestRunInfo;
    /// Make the outputDir relative to the current working directory to make the snapshot stable.
    if (testRunInfo.config.configFile) {
        testRunInfo.config.configFile = path.relative(process.cwd(), testRunInfo.config.configFile);
    }
    for (const project of testRunInfo.config.projects) {
        project.outputDir = path.relative(process.cwd(), project.outputDir);
    }
    expect(testRunInfo).toMatchSnapshot();
}, 60000);
