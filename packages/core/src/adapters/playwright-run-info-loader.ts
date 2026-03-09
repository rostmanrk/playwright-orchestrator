import { injectable } from 'inversify';
import type { RunInfoLoader } from './run-info-loader.js';
import type { TestRunInfo } from '../types/test-info.js';
import { spawnAsync } from '../helpers/spawn.js';

@injectable()
export class PlaywrightRunInfoLoader implements RunInfoLoader {
    async load(args: string[]): Promise<TestRunInfo> {
        const { stdout, stderr } = await spawnAsync('npx', [
            'playwright',
            'test',
            '--list',
            ...args,
            '--reporter',
            '@playwright-orchestrator/core/tests-info-reporter',
        ]);
        if (stderr) {
            throw new Error(stderr);
        }
        return JSON.parse(stdout) as TestRunInfo;
    }
}
