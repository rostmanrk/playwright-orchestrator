import { hash } from 'node:crypto';
import { TestRunConfig } from './types/test-info';
import { TestItem, Adapter } from './types/adapters';
import child_process from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import { createTempConfig } from './playwright-tools/modify-config';

const exec = promisify(child_process.exec);

export class TestRunner {
    private readonly runId: string;
    private readonly outputFolder: string;
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
        await this.runTestsUntilAvailable(config);
        await this.adapter.finishShard(this.runId);
        if (config.configFile) {
            await rm(config.configFile);
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
        try {
            await rm(`./${this.outputFolder}`, { recursive: true });
        } catch (error: any) {
            // Ignore if folder doesn't exist (ENOENT)
            if (error.code !== 'ENOENT') {
                throw error; // Re-throw other errors
            }
        }
    }

    private async runTest(test: TestItem, config: TestRunConfig) {
        const testPosition = `${test.file}:${test.position}`;
        const testName = `[${test.project}] > ${testPosition}`;
        try {
            const testHash = hash('md5', testName);
            console.log(`Running test: ${testName}`);
            await exec(`npx playwright test ${testPosition} ${this.buildParams(test, config, testHash)}`, {
                env: {
                    ...process.env,
                    PLAYWRIGHT_BLOB_OUTPUT_FILE: `./${this.outputFolder}/${testHash}.zip`,
                },
            });
            await this.adapter.finishTest(this.runId, test);
        } catch (error) {
            await this.adapter.failTest(this.runId, test);
        }
    }

    private buildParams(test: TestItem, config: TestRunConfig, testHash: string): string {
        const args = [...config.args];
        args.push('--workers', '1');
        args.push('--reporter', 'blob');
        args.push('--project', `"${test.project}"`);
        args.push('--output', `"${this.outputFolder}/${testHash}"`);
        if (config.configFile) {
            args.push('--config', `"${config.configFile}"`);
        }
        return args.join(' ');
    }
}
