import { injectable } from 'inversify';
import type { RunInfoLoader } from './run-info-loader.js';
import type { ReporterTestRunInfo } from '../types/test-info.js';
import { runPlaywright } from '../helpers/run-playwright.js';

@injectable()
export class PlaywrightRunInfoLoader implements RunInfoLoader {
    async load(args: string[]): Promise<ReporterTestRunInfo> {
        let parsedRunInfo: ReporterTestRunInfo | null = null;
        let stdout = '';
        await runPlaywright(
            [...args, '--list', '--reporter', '@playwright-orchestrator/core/run-info-reporter'],
            (line, isError) => {
                if (isError) {
                    console.error(line); // Log Playwright errors to the console
                } else {
                    stdout += `${line}\n`; // Accumulate stdout to parse the final run info
                    try {
                        const value = JSON.parse(line) as ReporterTestRunInfo;
                        if (value.config && value.testRun) {
                            parsedRunInfo = value;
                        }
                    } catch {}
                }
            },
        );
        if (!parsedRunInfo) {
            throw new Error(`Failed to load run info. Output:\n${stdout}`);
        }
        return parsedRunInfo!;
    }
}
