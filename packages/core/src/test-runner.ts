import { createHash } from 'node:crypto';
import { TestRunConfig } from './types/test-info.js';
import { TestItem, Adapter } from './types/adapters.js';
import child_process from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import { createTempConfig } from './playwright-tools/modify-config.js';
import { TestExecutionReporter } from './reporters/test-execution-reporter.js';
import { TestReportResult } from './types/reporter.js';

const exec = promisify(child_process.exec);

export class TestRunner {
    private readonly runId: string;
    private readonly outputFolder: string;
    private readonly reporter = new TestExecutionReporter();
    constructor(
        options: { runId: string; output: string },
        private readonly adapter: Adapter,
    ) {
        this.runId = options.runId;
        this.outputFolder = options.output;
    }

    async runTests() {
        await this.removePreviousReports();
        const config = await this.adapter.startShard(this.runId);
        config.configFile = await createTempConfig(config.configFile);
        try {
            await this.runTestsUntilAvailable(config);
            await this.adapter.finishShard(this.runId);
            await this.adapter.dispose();
            this.reporter.printSummary();
        } finally {
            if (config.configFile) await rm(config.configFile);
        }
    }

    private async runTestsUntilAvailable(config: TestRunConfig) {
        const runningTests = new Set<Promise<void>>();
        let next = await this.adapter.getNextTest(this.runId, config);
        while (next || runningTests.size > 0) {
            if (next && runningTests.size < config.workers) {
                const testPromise = this.runTest(next, config).then(() => {
                    runningTests.delete(testPromise);
                });
                runningTests.add(testPromise);
                next = await this.adapter.getNextTest(this.runId, config);
            } else {
                await Promise.race(runningTests);
            }
        }
        await Promise.all(runningTests);
    }

    private async removePreviousReports() {
        await rm(`./${this.outputFolder}`, { recursive: true, force: true });
    }

    private async runTest(test: TestItem, config: TestRunConfig) {
        const testPosition = `${test.file}:${test.position}`;
        const testName = `[${test.project}] > ${testPosition}`;
        const testHash = createHash('md5').update(testName).digest('hex');
        try {
            const run = exec(`npx playwright test ${testPosition} ${this.buildParams(test, config, testHash)}`, {
                env: {
                    ...process.env,
                    PLAYWRIGHT_BLOB_OUTPUT_FILE: `${this.outputFolder}/${testHash}.zip`,
                },
            });

            this.reporter.addTest(test, run);
            const { stdout } = await run;
            await this.adapter.finishTest({
                runId: this.runId,
                test,
                testResult: this.parseTestResult(stdout),
                config,
            });
        } catch (error: any) {
            if (!error.stdout) throw error;
            await this.adapter.failTest({
                runId: this.runId,
                test,
                testResult: this.parseTestResult(error.stdout),
                config,
            });
        }
    }

    private parseTestResult(stdout: string): TestReportResult {
        return JSON.parse(stdout) as TestReportResult;
    }

    private buildParams(test: TestItem, config: TestRunConfig, testHash: string): string {
        const args = [...config.args];
        args.push('--workers', '1');
        args.push('--reporter', 'blob,@playwright-orchestrator/core/test-result-reporter');
        args.push('--project', `"${test.project}"`);
        args.push('--output', `"${this.outputFolder}/${testHash}"`);
        if (config.configFile) {
            args.push('--config', `"${config.configFile}"`);
        }
        return args.join(' ');
    }
}
