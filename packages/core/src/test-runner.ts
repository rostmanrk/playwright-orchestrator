import { createHash } from 'node:crypto';
import { TestRunConfig } from './types/test-info.js';
import { TestItem } from './types/adapters.js';
import { rm, writeFile } from 'node:fs/promises';
import { TestExecutionReporter } from './reporters/test-execution-reporter.js';
import { TestReportResult } from './types/reporter.js';
import path from 'node:path';
import * as uuid from 'uuid';
import { injectable, inject } from 'inversify';
import type { Adapter } from './adapters/adapter.js';
import type { ShardHandler } from './adapters/shard-handler.js';
import { SYMBOLS } from './container.js';
import { spawnAsync } from './helpers/spawn.js';
import { BrowserManager } from './browser-manager.js';

@injectable()
export class TestRunner {
    private readonly reporter = new TestExecutionReporter();

    constructor(
        @inject(SYMBOLS.RunId) private readonly runId: string,
        @inject(SYMBOLS.OutputFolder) private readonly outputFolder: string,
        @inject(SYMBOLS.Adapter) private readonly adapter: Adapter,
        @inject(SYMBOLS.ShardHandler) private readonly shardHandler: ShardHandler,
        @inject(SYMBOLS.BrowserManager) private readonly browserManager: BrowserManager,
    ) {}

    async runTests() {
        await this.removePreviousReports();
        const config = await this.shardHandler.startShard(this.runId);
        const browserLinks = await this.browserManager.runBrowsers(config);
        config.configFile = await this.createTempConfig(config.configFile, browserLinks);

        const cleanupTempFile = () => {
            if (config.configFile) rm(config.configFile, { force: true }).catch(() => {});
        };
        const signalHandler = () => {
            cleanupTempFile();
            process.exit(1);
        };
        process.once('SIGINT', signalHandler);
        process.once('SIGTERM', signalHandler);

        try {
            await this.runTestsUntilAvailable(config);
        } finally {
            process.off('SIGINT', signalHandler);
            process.off('SIGTERM', signalHandler);
            this.reporter.printSummary();
            try {
                await this.shardHandler.finishShard(this.runId);
            } finally {
                cleanupTempFile();
            }
        }
    }

    private async runTestsUntilAvailable(config: TestRunConfig) {
        const runningTests = new Set<Promise<void>>();
        let next = await this.shardHandler.getNextTest(this.runId, config);
        while (next || runningTests.size > 0) {
            if (next && runningTests.size < config.workers) {
                const testPromise = this.runTest(next, config).then(() => {
                    runningTests.delete(testPromise);
                });
                runningTests.add(testPromise);
                next = await this.shardHandler.getNextTest(this.runId, config);
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
            const run = spawnAsync(
                'npx',
                ['playwright', 'test', testPosition, ...this.buildParams(test, config, testHash)],
                {
                    env: {
                        ...process.env,
                        PLAYWRIGHT_BLOB_OUTPUT_FILE: `${this.outputFolder}/${testHash}.zip`,
                    },
                },
            );

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

    private buildParams(test: TestItem, config: TestRunConfig, testHash: string): string[] {
        const args = [...config.args];
        args.push('--workers', '1');
        args.push('--reporter', 'blob,@playwright-orchestrator/core/test-result-reporter');
        args.push('--project', test.project);
        args.push('--output', `${this.outputFolder}/${testHash}`);
        if (config.configFile) {
            args.push('--config', config.configFile);
        }
        return args;
    }

    private async createTempConfig(
        file: string | undefined,
        browsers: Record<string, string>,
    ): Promise<string | undefined> {
        if (!file) return;
        // Remove webServer from the config. Not supported in the orchestrator
        const content = `
import config from '${path.resolve(file)}';

const browsers = ${JSON.stringify(browsers)};

config.webServer = undefined;
for (const project of config?.projects ?? []) {
    if (!project.use) {
        project.use = {};
    }
    if (!project.use.connectOptions) {
        project.use.connectOptions = {};
    }
    if(!project.use.connectOptions.wsEndpoint) {
        project.use.connectOptions.wsEndpoint = browsers[project.name];
    }
}

export default config;`;

        const tempFile = `.playwright-${uuid.v7()}.config.tmp.ts`;
        await writeFile(tempFile, content);
        return tempFile;
    }
}
