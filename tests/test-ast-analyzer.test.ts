import { test, expect } from 'vitest';
import { ReporterTestRunInfo } from '@playwright-orchestrator/core';
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
        '@playwright-orchestrator/core/run-info-reporter',
        '-j',
        '2',
    ]);

    const testRunInfo = JSON.parse(commandResult.stdout) as ReporterTestRunInfo;
    expect(testRunInfo).toMatchSnapshot();
}, 60000);
