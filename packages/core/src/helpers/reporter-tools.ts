import child_process from 'node:child_process';
import { promisify } from 'node:util';
import { TestRunInfo } from '../types/test-info.js';

const exec = promisify(child_process.exec);

export async function loadReporterInfo(args: string[]): Promise<TestRunInfo> {
    const { stdout, stderr } = await exec(buildCommand(args));
    if (stderr) {
        throw new Error(stderr);
    }
    return JSON.parse(stdout) as TestRunInfo;
}

function buildCommand(args: string[]): string {
    // last param wins, so we need to put our reporter at the end
    return `npx playwright test --list ${args.join(' ')} --reporter "@playwright-orchestrator/core/tests-info-reporter"`;
}
