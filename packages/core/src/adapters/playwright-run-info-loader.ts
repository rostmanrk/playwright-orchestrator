import { injectable } from 'inversify';
import child_process from 'node:child_process';
import { promisify } from 'node:util';
import type { RunInfoLoader } from './run-info-loader.js';
import type { TestRunInfo } from '../types/test-info.js';

const exec = promisify(child_process.exec);

@injectable()
export class PlaywrightRunInfoLoader implements RunInfoLoader {
    async load(args: string[]): Promise<TestRunInfo> {
        const { stdout, stderr } = await exec(this.buildCommand(args));
        if (stderr) {
            throw new Error(stderr);
        }
        return JSON.parse(stdout) as TestRunInfo;
    }

    private buildCommand(args: string[]): string {
        return `npx playwright test --list ${args.join(' ')} --reporter "@playwright-orchestrator/core/tests-info-reporter"`;
    }
}
