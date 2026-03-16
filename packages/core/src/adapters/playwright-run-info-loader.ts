import { injectable } from 'inversify';
import type { RunInfoLoader } from './run-info-loader.js';
import type { TestRunInfo } from '../types/test-info.js';
import { spawnAsync } from '../helpers/spawn.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

@injectable()
export class PlaywrightRunInfoLoader implements RunInfoLoader {
    async load(args: string[]): Promise<TestRunInfo> {
        const req = createRequire(join(process.cwd(), 'package.json'));
        const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');
        const { stdout } = await spawnAsync(process.execPath, [
            playwrightCli,
            'test',
            ...args,
            '--list',
            '--reporter',
            '@playwright-orchestrator/core/run-info-reporter',
        ]);
        return JSON.parse(stdout) as TestRunInfo;
    }
}
