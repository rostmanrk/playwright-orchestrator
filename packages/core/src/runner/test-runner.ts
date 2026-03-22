import { TestItem, TestRunConfig } from '../types/adapters.js';
import { rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { TestExecutionReporter } from './test-execution-reporter.js';
import path from 'node:path';
import * as uuid from 'uuid';
import { injectable, inject } from 'inversify';
import type { ShardHandler } from '../adapters/shard-handler.js';
import type { BatchHandlerFactory } from '../commands/run.js';
import { BrowserManager } from './browser-manager.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cp } from 'node:fs/promises';
import { SYMBOLS } from '../symbols.js';
import type { TestEventHandlerFactory } from './test-event-handler.js';
import { cliVersion } from '../commands/version.js';

@injectable()
export class TestRunner {
    private cleanupFs = new Set<string>();

    constructor(
        @inject(SYMBOLS.RunId) private readonly runId: string,
        @inject(SYMBOLS.OutputFolder) private readonly outputFolder: string,
        @inject(SYMBOLS.ShardHandler) private readonly shardHandler: ShardHandler,
        @inject(SYMBOLS.BrowserManager) private readonly browserManager: BrowserManager,
        @inject(SYMBOLS.BatchHandlerFactory) private readonly batchHandlerFactory: BatchHandlerFactory,
        @inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter,
        @inject(SYMBOLS.TestEventHandlerFactory) private readonly testEventHandlerFactory: TestEventHandlerFactory,
    ) {}

    async runTests(): Promise<boolean> {
        await this.removePreviousReports();
        const config = await this.shardHandler.startShard(this.runId);
        if (config.version !== cliVersion) {
            console.error(
                `Version mismatch: Orchestrator CLI version is ${cliVersion} but test run was created with version ${config.version}. Please make sure to use the same version of Playwright Orchestrator across all your machines.`,
            );
            process.exitCode = 1;
            return false;
        }
        const browsers = await this.browserManager.runBrowsers(config);
        config.configFile = await this.createTempConfig(config.configFile);
        if (config.configFile) {
            this.cleanupFs.add(config.configFile);
        }

        const signalHandler = () => {
            this.cleanupTemp();
            process.exit(1);
        };
        process.once('SIGINT', signalHandler);
        process.once('SIGTERM', signalHandler);

        try {
            await this.runTestsUntilAvailable(config, browsers);
        } finally {
            process.off('SIGINT', signalHandler);
            process.off('SIGTERM', signalHandler);
            this.reporter.printSummary();
            try {
                await this.shardHandler.finishShard(this.runId);
            } finally {
                this.cleanupTemp();
            }
        }
        return !this.reporter.hasFailed();
    }

    private cleanupTemp() {
        for (const entry of this.cleanupFs) {
            try {
                rmSync(entry, { force: true, recursive: true });
            } catch (err) {
                // Ignore errors during cleanup.
            }
        }
        this.cleanupFs.clear();
    }

    private async runTestsUntilAvailable(config: TestRunConfig, browsers: Record<string, string>) {
        const batchHandler = this.batchHandlerFactory(config.options.batchMode);
        const runningBatches = new Set<Promise<void>>();
        let batchNumber = 0;
        let nextBatch = await batchHandler.getNextBatch(this.runId, config);
        while (nextBatch || runningBatches.size > 0) {
            if (nextBatch && runningBatches.size < config.workers) {
                batchNumber++;
                const batchPromise = this.runTestBatch(nextBatch, config, browsers, batchNumber).finally(() => {
                    runningBatches.delete(batchPromise);
                });
                runningBatches.add(batchPromise);
                nextBatch = await batchHandler.getNextBatch(this.runId, config);
            } else {
                await Promise.race(runningBatches);
            }
        }
        await Promise.all(runningBatches);
    }

    private async removePreviousReports() {
        await rm(`./${this.outputFolder}`, { recursive: true, force: true });
    }

    private async runTestBatch(
        tests: TestItem[],
        config: TestRunConfig,
        browsers: Record<string, string>,
        batchNumber: number,
    ) {
        const batchName = `Batch ${batchNumber}`;
        const { onData, onExit, batchResolver } = this.testEventHandlerFactory(tests, config, batchName);

        const batchId = uuid.v7();
        const batchFolder = `batch-${batchId}`;
        const batchArtifactsFolder = `batch-artifacts-${batchId}`;
        try {
            await new Promise<void>((resolve, reject) => {
                const playwright = spawn(
                    'npx',
                    ['playwright', 'test', ...this.buildParams(tests, config), '--output', batchArtifactsFolder],
                    {
                        env: {
                            ...process.env,
                            PLAYWRIGHT_BLOB_OUTPUT_DIR: batchFolder,
                            ...(config.configFile && {
                                PLAYWRIGHT_ORCHESTRATOR_BROWSERS: JSON.stringify(browsers),
                            }),
                            PLAYWRIGHT_ORCHESTRATOR_GROUPING: config.options.grouping,
                        },
                    },
                );
                this.cleanupFs.add(batchFolder);
                this.cleanupFs.add(batchArtifactsFolder);
                createInterface({ input: playwright.stdout, crlfDelay: Infinity }).on('line', onData);
                playwright.on('exit', () => onExit().then(resolve, reject));
            });
            await cp(batchFolder, this.outputFolder, { recursive: true });
            await cp(batchArtifactsFolder, this.outputFolder, { recursive: true });
            batchResolver.success();
        } catch (err) {
            batchResolver.fail(err);
            throw err;
        } finally {
            await Promise.all([
                rm(batchFolder, { recursive: true, force: true }),
                rm(batchArtifactsFolder, { recursive: true, force: true }),
            ]);
            this.cleanupFs.delete(batchFolder);
            this.cleanupFs.delete(batchArtifactsFolder);
        }
    }

    private buildParams(tests: TestItem[], config: TestRunConfig): string[] {
        const args = [];
        const projects = new Set<string>();
        for (const test of tests) {
            args.push(`${test.file}:${test.position}`);
            for (const project of test.projects) {
                projects.add(project);
            }
        }
        args.push(...config.args);
        args.push('--workers', '1');
        args.push('--reporter', 'blob,@playwright-orchestrator/core/test-result-reporter');
        for (const project of projects) {
            args.push('--project', project);
        }
        if (config.configFile) {
            args.push('--config', config.configFile);
        }
        return args;
    }

    private async createTempConfig(file: string | undefined): Promise<string | undefined> {
        if (!file) return;
        // Remove webServer from config (not supported in the orchestrator).
        // Browser endpoints are injected via PLAYWRIGHT_ORCHESTRATOR_BROWSERS env var.
        const content = `
import config from '${path.resolve(file)}';

const browsers: Record<string, string> = JSON.parse(process.env.PLAYWRIGHT_ORCHESTRATOR_BROWSERS ?? '{}');

config.webServer = undefined;
for (const project of config?.projects ?? []) {
    if (!project.use) project.use = {};
    if (!project.use.connectOptions) project.use.connectOptions = {};
    if (!project.use.connectOptions.wsEndpoint) {
        project.use.connectOptions.wsEndpoint = browsers[project.name!];
    }
}

export default config;`;

        const tempFile = path.join(path.dirname(path.resolve(file)), `.playwright-${uuid.v7()}.config.tmp.ts`);
        await writeFile(tempFile, content);
        return tempFile;
    }
}
