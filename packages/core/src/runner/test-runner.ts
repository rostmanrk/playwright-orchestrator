import type { TestItem, TestRunConfig, TestRunContext } from '../types/adapters.js';
import { rm, writeFile } from 'node:fs/promises';
import { rmSync } from 'node:fs';
import { TestExecutionReporter } from './test-execution-reporter.js';
import path from 'node:path';
import { tmpdir } from 'node:os';
import * as uuid from 'uuid';
import { injectable, inject } from 'inversify';
import type { ShardHandler } from '../adapters/shard-handler.js';
import type { BatchHandlerFactory } from '../commands/run.js';
import { BrowserManager } from './browser-manager.js';
import { WebServerManager } from './web-server-manager.js';
import { GlobalSetupManager } from './global-setup-manager.js';
import { SYMBOLS } from '../symbols.js';
import { playwrightVersion, runPlaywright, supportsTestList } from '../helpers/run-playwright.js';
import type { TestEventHandlerFactory } from './test-event-handler.js';
import { cliVersion } from '../commands/version.js';
import { registerOnExit, registerOnInterrupt } from '../helpers/register-on-exit.js';
import { PlaywrightConfigLoader } from '../helpers/playwright-config.js';
import { buildTestList, canSelectWithTestList } from '../helpers/test-list.js';
import { makeGrepPatterns } from '../helpers/regex.js';

@injectable()
export class TestRunner {
    private cleanupFs = new Set<string>();
    private readonly useTestList = supportsTestList();
    private readonly interruption = new AbortController();

    constructor(
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
        @inject(SYMBOLS.ShardHandler) private readonly shardHandler: ShardHandler,
        @inject(SYMBOLS.BrowserManager) private readonly browserManager: BrowserManager,
        @inject(SYMBOLS.WebServerManager) private readonly webServerManager: WebServerManager,
        @inject(SYMBOLS.GlobalSetupManager) private readonly globalSetupManager: GlobalSetupManager,
        @inject(SYMBOLS.BatchHandlerFactory) private readonly batchHandlerFactory: BatchHandlerFactory,
        @inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter,
        @inject(SYMBOLS.TestEventHandlerFactory) private readonly testEventHandlerFactory: TestEventHandlerFactory,
        @inject(SYMBOLS.PlaywrightConfigLoader) private readonly configLoader: PlaywrightConfigLoader,
    ) {
        registerOnExit(() => {
            this.cleanupTemp();
        });
    }

    async runTests(): Promise<boolean> {
        await this.removePreviousOutput();
        const config = await this.shardHandler.startShard();
        if (config.version !== cliVersion) {
            console.error(
                `Version mismatch: Orchestrator CLI version is ${cliVersion} but test run was created with version ${config.version}. Please make sure to use the same version of Playwright Orchestrator across all your machines.`,
            );
            process.exitCode = 1;
            return false;
        }
        if (!this.useTestList) {
            this.reporter.warn(
                `Playwright ${playwrightVersion} is deprecated. Support for Playwright older than 1.56 will be removed in a future release. ` +
                    'Until then tests are selected with --grep, which is less exact than --test-list. Please upgrade Playwright.',
            );
        }
        // The shard is started, so finish it even when setup or teardown fails
        try {
            await this.setupAndRunTests(config);
        } finally {
            this.reporter.printSummary();
            await this.shardHandler.finishShard();
        }
        return !this.reporter.hasFailed();
    }

    private async setupAndRunTests(config: TestRunConfig) {
        await this.configLoader.loadPlaywrightConfig(config.configFile);
        const [browsers] = await Promise.all([
            this.browserManager.runBrowsers(config),
            this.webServerManager.startServers(),
        ]);
        config.configFile = await this.createTempConfig(config.configFile);
        if (config.configFile) {
            this.cleanupFs.add(config.configFile);
        }
        // Teardown also runs when setup fails part way, to undo what it did
        try {
            await this.globalSetupManager.runSetup(config, browsers);
            await this.runTestsUntilAvailable(config, browsers);
        } finally {
            await this.globalSetupManager.runTeardown(config, browsers);
        }
    }

    private cleanupTemp() {
        for (const entry of this.cleanupFs) {
            rmSync(entry, { force: true, recursive: true });
        }
        this.cleanupFs.clear();
    }

    private async removePreviousOutput() {
        await rm(this.runContext.outputFolder, { recursive: true, force: true });
    }

    private async runTestsUntilAvailable(config: TestRunConfig, browsers: Record<string, string>) {
        const removeInterruptHandler = registerOnInterrupt((signal) => {
            this.reporter.warn(`Received ${signal}, stopping running tests. Send it again to exit immediately.`);
            this.interruption.abort();
        });
        try {
            await this.runBatches(config, browsers);
        } finally {
            removeInterruptHandler();
        }
    }

    private async runBatches(config: TestRunConfig, browsers: Record<string, string>) {
        const batchHandler = this.batchHandlerFactory(config.options.batchMode);
        const runningBatches = new Set<Promise<void>>();
        let batchNumber = 0;
        let nextBatch = await batchHandler.getNextBatch(config);
        while (nextBatch || runningBatches.size > 0) {
            if (nextBatch && runningBatches.size < config.workers) {
                batchNumber++;
                const batchPromise = this.runTestBatch(nextBatch, config, browsers, batchNumber).finally(() => {
                    runningBatches.delete(batchPromise);
                });
                runningBatches.add(batchPromise);
                nextBatch = this.interruption.signal.aborted ? undefined : await batchHandler.getNextBatch(config);
            } else {
                await Promise.race(runningBatches);
            }
        }
        await Promise.all(runningBatches);
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

        const batchArtifact = path.relative(process.cwd(), `${this.runContext.outputFolder}/${batchId}.zip`);
        const testListFile = path.join(tmpdir(), `playwright-orchestrator-${batchId}.test-list.txt`);
        this.cleanupFs.add(testListFile);
        try {
            const selection = await this.selectTests(tests, testListFile);
            const exitCode = await runPlaywright(
                this.buildParams(tests, config, selection),
                onData,
                {
                    ...process.env,
                    PLAYWRIGHT_BLOB_OUTPUT_FILE: batchArtifact,
                    ...(config.configFile && {
                        PLAYWRIGHT_ORCHESTRATOR_BROWSERS: JSON.stringify(browsers),
                    }),
                    PLAYWRIGHT_ORCHESTRATOR_GROUPING: config.options.grouping,
                },
                this.interruption.signal,
            ).catch(async (err) => {
                // Playwright failed to start, so none of the batch's tests reported. Save them as failed first.
                await onExit(null);
                throw err;
            });
            const allReported = await onExit(exitCode);
            if (allReported) {
                batchResolver.success();
            } else {
                batchResolver.fail();
            }
        } catch (err) {
            batchResolver.fail(err);
            throw err;
        } finally {
            await rm(testListFile, { force: true });
            this.cleanupFs.delete(testListFile);
        }
    }

    /** Arguments that make Playwright run exactly the batch's tests */
    private async selectTests(tests: TestItem[], testListFile: string): Promise<string[]> {
        if (!this.useTestList || !canSelectWithTestList(tests)) {
            return ['--grep', tests.flatMap(({ meta }) => makeGrepPatterns(meta)).join('|')];
        }
        await writeFile(testListFile, buildTestList(tests));
        return ['--test-list', testListFile];
    }

    private buildParams(tests: TestItem[], config: TestRunConfig, selection: string[]): string[] {
        const args = [];
        const projects = new Set<string>();
        for (const test of tests) {
            for (const project of test.meta.projects) {
                projects.add(project);
            }
        }
        args.push(...selection);
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
        // Browser endpoints are injected via PLAYWRIGHT_ORCHESTRATOR_BROWSERS env var.
        const content = `
import config from '${path.resolve(file).replace(/\\/g, '/')}';

const browsers: Record<string, string> = JSON.parse(process.env.PLAYWRIGHT_ORCHESTRATOR_BROWSERS ?? '{}');

config.webServer = undefined;
config.globalSetup = undefined;
config.globalTeardown = undefined;
for (const project of config?.projects ?? []) {
    if (!project.use) project.use = {};
    const wsEndpoint = browsers[project.name!];
    if (wsEndpoint) {
        if (!project.use.connectOptions) project.use.connectOptions = {};
        project.use.connectOptions.wsEndpoint = wsEndpoint;
    }
    project.dependencies = [];
    project.teardown = undefined;
}

export default config;`;

        const tempFile = path.join(path.dirname(path.resolve(file)), `.playwright-${uuid.v7()}.config.tmp.ts`);
        await writeFile(tempFile, content);
        return tempFile;
    }
}
