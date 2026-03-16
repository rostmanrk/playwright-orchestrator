import { TestRunConfig, TestStatus } from '../types/test-info.js';
import { TestItem } from '../types/adapters.js';
import { rm, writeFile } from 'node:fs/promises';
import { TestExecutionReporter } from '../reporters/test-execution-reporter.js';
import { TestInfoResult, TestReportEvent } from '../types/reporter.js';
import path from 'node:path';
import * as uuid from 'uuid';
import { injectable, inject } from 'inversify';
import type { Adapter } from '../adapters/adapter.js';
import type { ShardHandler } from '../adapters/shard-handler.js';
import type { BatchHandler } from '../batch/batch-handler.js';
import { BrowserManager } from './browser-manager.js';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { cp } from 'node:fs/promises';
import { SYMBOLS } from '../symbols.js';
import { withRetry } from '../helpers/with-retry.js';

@injectable()
export class TestRunner {
    constructor(
        @inject(SYMBOLS.RunId) private readonly runId: string,
        @inject(SYMBOLS.OutputFolder) private readonly outputFolder: string,
        @inject(SYMBOLS.Adapter) private readonly adapter: Adapter,
        @inject(SYMBOLS.ShardHandler) private readonly shardHandler: ShardHandler,
        @inject(SYMBOLS.BrowserManager) private readonly browserManager: BrowserManager,
        @inject(SYMBOLS.BatchHandler) private readonly batchHandler: BatchHandler,
        @inject(SYMBOLS.TestExecutionReporter) private readonly reporter: TestExecutionReporter,
    ) {}

    async runTests() {
        await this.removePreviousReports();
        const config = await this.shardHandler.startShard(this.runId);
        const browsers = await this.browserManager.runBrowsers(config);
        config.configFile = await this.createTempConfig(config.configFile);

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
            await this.runTestsUntilAvailable(config, browsers);
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

    private async runTestsUntilAvailable(config: TestRunConfig, browsers: Record<string, string>) {
        const runningBatches = new Set<Promise<void>>();
        let nextBatch = await this.batchHandler.getNextBatch(this.runId, config);
        while (nextBatch || runningBatches.size > 0) {
            if (nextBatch && runningBatches.size < config.workers) {
                const batchPromise = this.runTestBatch(nextBatch, config, browsers).finally(() => {
                    runningBatches.delete(batchPromise);
                });
                runningBatches.add(batchPromise);
                nextBatch = await this.batchHandler.getNextBatch(this.runId, config);
            } else {
                await Promise.race(runningBatches);
            }
        }
        await Promise.all(runningBatches);
    }

    private async removePreviousReports() {
        await rm(`./${this.outputFolder}`, { recursive: true, force: true });
    }

    private async runTestBatch(tests: TestItem[], config: TestRunConfig, browsers: Record<string, string>) {
        const batchId = uuid.v7();
        const batchFolder = `batch-${batchId}`;
        const batchArtifactsFolder = `batch-artifacts-${batchId}`;
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
                    },
                },
            );
            const { onData, onExit } = this.handleTestResultEvent(tests, config);
            createInterface({ input: playwright.stdout, crlfDelay: Infinity }).on('line', onData);
            playwright.on('exit', () => onExit().then(resolve, reject));
        });
        await withRetry(() => cp(batchFolder, this.outputFolder, { recursive: true }), 3);
        await withRetry(() => cp(batchArtifactsFolder, this.outputFolder, { recursive: true }), 3);
        await Promise.all([
            rm(batchFolder, { recursive: true, force: true }),
            rm(batchArtifactsFolder, { recursive: true, force: true }),
        ]);
    }

    private handleTestResultEvent(tests: TestItem[], config: TestRunConfig) {
        const { mapping: testMapping, counts: testCounts } = this.createTestMapping(tests);
        const testResolvers: Map<string, { success: () => void; fail: (reason?: any) => void }> = new Map();
        const testResults: Map<string, TestInfoResult[]> = new Map();
        const pending: Promise<void>[] = [];

        const createTestPromise = (id: string) =>
            new Promise<void>((resolve, reject) => {
                testResolvers.set(id, { success: resolve, fail: reject });
            });

        const onData = (data: any) => {
            let event: TestReportEvent;
            try {
                event = JSON.parse(data.toString()) as TestReportEvent;
            } catch (error) {
                this.reporter.error(`Failed to parse test report event`);
                return;
            }
            const {
                type,
                test: { testId, ok, title, annotations, retries },
                result: { duration, status, retry },
            } = event;
            const test = testMapping.get(testId)!;

            if (type === 'begin' && !testResolvers.has(testId)) {
                this.reporter.addTest(test, createTestPromise(testId));
            }

            if (type === 'end') {
                if (ok || retries === retry) {
                    testCounts.set(testId, (testCounts.get(testId) ?? 1) - 1);
                }
                if (!testResults.has(testId)) testResults.set(testId, []);
                testResults.get(testId)!.push({ annotations, duration, status, title, retry });
                if ((testCounts.get(testId) ?? 0) === 0) {
                    const { success, fail } = testResolvers.get(testId)!;
                    pending.push(
                        this.saveTestResult(event, test, testResults, config).then(() => {
                            ok ? success() : fail();
                        }),
                    );
                }
            }
        };

        const onExit = () => Promise.all(pending).then(() => {});

        return { onData, onExit };
    }

    private async saveTestResult(
        event: TestReportEvent,
        test: TestItem,
        testResults: Map<string, TestInfoResult[]>,
        config: TestRunConfig,
    ) {
        const {
            test: { testId, ok, title, annotations },
            result: { duration, status, error },
        } = event;
        await this.adapter.updateTestWithResults(ok ? TestStatus.Passed : TestStatus.Failed, {
            runId: this.runId,
            test,
            testResult: {
                annotations,
                duration,
                status,
                error,
                title,
                tests: testResults.get(testId) ?? [],
            },
            config,
        });
    }

    private createTestMapping(tests: TestItem[]): { mapping: Map<string, TestItem>; counts: Map<string, number> } {
        const mapping = new Map<string, TestItem>();
        const counts = new Map<string, number>();
        for (const test of tests) {
            mapping.set(test.testId, test);
            for (const childId of test.children ?? []) {
                mapping.set(childId, test);
            }
            counts.set(test.testId, test.children?.length ?? 1);
        }
        return { mapping, counts };
    }

    private buildParams(tests: TestItem[], config: TestRunConfig): string[] {
        const args = [];
        const projects = new Set<string>();
        for (const test of tests) {
            args.push(`${test.file}:${test.position}`);
            projects.add(test.project);
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
