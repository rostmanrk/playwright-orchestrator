import { test, expect } from 'vitest';
import { TestRunInfo } from '@playwright-orchestrator/core';
import path from 'node:path';
import { spawnAsync } from '../packages/core/src/helpers/spawn.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const req = createRequire(join(process.cwd(), 'package.json'));
const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');

test('test custom info reporter', async () => {
    const commandResult = await spawnAsync(process.execPath, [
        playwrightCli,
        'test',
        '--list',
        '--reporter',
        '@playwright-orchestrator/core/tests-info-reporter',
        '-j',
        '2',
    ]);

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
