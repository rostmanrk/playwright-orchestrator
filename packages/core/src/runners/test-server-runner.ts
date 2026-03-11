import { spawn } from 'node:child_process';
import { writeFile, rm, cp } from 'node:fs/promises';
import path from 'node:path';
import * as uuid from 'uuid';
import { injectable, inject } from 'inversify';
import type { Adapter } from '../adapters/adapter.js';
import type { ShardHandler } from '../adapters/shard-handler.js';
import { SYMBOLS } from '../container.js';
import type { TestRunner } from '../types/test-runner.js';
import { TestExecutionReporter } from '../reporters/test-execution-reporter.js';
import type { TestRunConfig } from '../types/test-info.js';
import type { TestItem } from '../types/adapters.js';
import type { TestReportResult } from '../types/reporter.js';
import {
    OnTestBeginArgs,
    OnTestEndArgs,
    TestServerProject,
    TestServerSuiteEntry,
    TestServerTestEntry,
} from '../types/test-server.js';
import { TestDetailsAnnotation } from 'playwright/test';
import { BrowserManager } from './browser-manager.js';

// NOTE: native WebSocket requires Node 22+.
// For Node 20 support, replace with the 'ws' package.
type Connection = ReturnType<typeof createConnection>;
type TestResults = { begin: OnTestBeginArgs[]; end: OnTestEndArgs[] };

function createConnection(url: string) {
    const ws = new WebSocket(url);
    let lastId = 0;
    const callbacks = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
    const listeners = new Map<string, Array<(params: any) => void>>();

    ws.onmessage = (event) => {
        const msg = JSON.parse(event.data as string);
        if (msg.id) {
            const cb = callbacks.get(msg.id);
            if (!cb) return;
            callbacks.delete(msg.id);
            if (msg.error) cb.reject(new Error(msg.error));
            else cb.resolve(msg.result);
        } else {
            listeners.get(msg.method)?.forEach((fn) => fn(msg.params));
        }
    };

    const send = (method: string, params?: any): Promise<any> =>
        new Promise((resolve, reject) => {
            const id = ++lastId;
            callbacks.set(id, { resolve, reject });
            ws.send(JSON.stringify({ id, method, params }));
        });

    const on = (event: string, fn: (params: any) => void) => {
        if (!listeners.has(event)) listeners.set(event, []);
        listeners.get(event)!.push(fn);
        return () => {
            const fns = listeners.get(event);
            if (fns)
                listeners.set(
                    event,
                    fns.filter((f) => f !== fn),
                );
        };
    };

    const ready = new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve();
        ws.onerror = () => reject(new Error('WebSocket connection failed'));
    });

    return { send, on, ready, close: () => ws.close() };
}

interface ServerConnection {
    connection: Connection;
    outputDir: string;
}

class ConnectionPool {
    private available: ServerConnection[] = [];
    private waiters: Array<(conn: ServerConnection) => void> = [];
    add(conn: ServerConnection) {
        const waiter = this.waiters.shift();
        if (waiter) waiter(conn);
        else this.available.push(conn);
    }

    acquire(): Promise<ServerConnection> {
        const conn = this.available.pop();
        if (conn) return Promise.resolve(conn);
        return new Promise((resolve) => this.waiters.push(resolve));
    }

    release(conn: ServerConnection) {
        const waiter = this.waiters.shift();
        if (waiter) waiter(conn);
        else this.available.push(conn);
    }

    async closeAll() {
        for (const conn of this.available) {
            conn.connection.close();
            await rm(conn.outputDir, { recursive: true, force: true });
        }
        this.available = [];
    }
}

function extractDataFromSuite(suite: TestServerSuiteEntry | TestServerTestEntry): {
    annotations: TestDetailsAnnotation[];
    titles: Record<string, string>;
} {
    if ('testId' in suite) {
        return { annotations: suite.annotations, titles: { [suite.testId]: suite.title } };
    }
    const annotations: TestDetailsAnnotation[] = [];
    let titles: Record<string, string> = {};
    for (const entry of suite.entries) {
        if ('testId' in entry) {
            annotations.push(...entry.annotations);
            titles[entry.testId] = entry.title;
        } else {
            const { annotations: childAnnotations, titles: childTitles } = extractDataFromSuite(entry);
            annotations.push(...childAnnotations);
            titles = { ...titles, ...childTitles };
        }
    }
    return { annotations, titles };
}

function lowestCommonEntry(suite: TestServerSuiteEntry): TestServerSuiteEntry | TestServerTestEntry | undefined {
    if (suite.entries.length === 0) return undefined;
    if (suite.entries.length === 1) {
        const onlyEntry = suite.entries[0];
        if ('testId' in onlyEntry) return onlyEntry;
        return lowestCommonEntry(onlyEntry);
    }
    var results = [];
    for (const entry of suite.entries) {
        if ('testId' in entry) results.push(entry);
        else {
            const childResult = lowestCommonEntry(entry);
            if (childResult) results.push(childResult);
        }
    }
    if (results.length === 1) return results[0];
    if (results.length > 1) return suite;
    return undefined;
}

function buildResult(project: TestServerProject, results: TestResults): TestReportResult {
    const lce = lowestCommonEntry(project.suites[0])!;
    const { annotations, titles } = extractDataFromSuite(lce);
    const last = results.end.at(-1)!;
    return {
        title: lce.title,
        annotations,
        status: last.result.status,
        duration: results.end.reduce((acc, { result }) => acc + result.duration, 0),
        error: last.result.errors.at(0),
        tests: results.end.map(
            ({ test: { annotations: testAnnotations, testId }, result: { status, duration, errors } }, idx) => ({
                status,
                duration,
                errors: errors.at(-1),
                annotations: testAnnotations,
                title: titles[testId],
                retry: results.begin[idx].result.retry,
            }),
        ),
    };
}

@injectable()
export class TestServerRunner implements TestRunner {
    private readonly reporter = new TestExecutionReporter();
    private readonly pool = new ConnectionPool();
    private readonly killServers: Array<() => void> = [];

    constructor(
        @inject(SYMBOLS.RunId) private readonly runId: string,
        @inject(SYMBOLS.OutputFolder) private readonly outputFolder: string,
        @inject(SYMBOLS.Adapter) private readonly adapter: Adapter,
        @inject(SYMBOLS.ShardHandler) private readonly shardHandler: ShardHandler,
        @inject(SYMBOLS.BrowserManager) private readonly browserManager: BrowserManager,
    ) {}

    async runTests() {
        await this.cleanPreviousRuns();
        const config = await this.shardHandler.startShard(this.runId);
        const tempConfigFile = await this.createTempConfig(this.runId, config.configFile);

        const signalHandler = () => this.cleanup(tempConfigFile).finally(() => process.exit(1));
        process.once('SIGINT', signalHandler);
        process.once('SIGTERM', signalHandler);

        try {
            for (let i = 0; i < config.workers; i++) {
                const { url, kill, outputDir } = await this.startTestServer(tempConfigFile);
                this.killServers.push(kill);
                const connection = createConnection(url);
                await connection.ready;
                await connection.send('initialize', { interceptStdio: false, closeOnDisconnect: false });
                this.pool.add({ connection, outputDir });
            }

            await this.runTestsUntilAvailable(config);
        } finally {
            process.off('SIGINT', signalHandler);
            process.off('SIGTERM', signalHandler);
            this.reporter.printSummary();
            try {
                await this.shardHandler.finishShard(this.runId);
            } finally {
                await this.cleanup(tempConfigFile);
            }
        }
    }

    private async cleanup(tempConfigFile: string | undefined) {
        await this.pool.closeAll();
        this.killServers.forEach((kill) => kill());
        if (tempConfigFile) await rm(tempConfigFile, { force: true });
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

    private async runTest(test: TestItem, config: TestRunConfig) {
        const location = `${test.file}:${test.position}`;
        const conn = await this.pool.acquire();

        let resolveRun!: () => void;
        let rejectRun!: (e: Error) => void;
        const run = new Promise<void>((res, rej) => {
            resolveRun = res;
            rejectRun = rej;
        });
        this.reporter.addTest(test, run);

        try {
            let project: TestServerProject | undefined;
            let results: TestResults = { begin: [], end: [] };
            const unsubscribe = conn.connection.on('report', ({ method, params }) => {
                if (method === 'onProject') {
                    project = params.project;
                } else if (method === 'onTestBegin') {
                    results.begin.push(params);
                } else if (method === 'onTestEnd') {
                    results.end.push(params);
                }
            });

            const testProject = config.projects.find((p) => p.name === test.project)!;

            await conn.connection.send('runTests', {
                locations: [location],
                projects: [test.project],
                workers: 1,
                reporters: ['blob'],
                normalMode: true,
                connectWsEndpoint: await this.browserManager.getBrowserLink(testProject),
            });

            await cp(conn.outputDir, this.outputFolder, { recursive: true });

            unsubscribe();

            const testResult = buildResult(project!, results);
            const failed = testResult.status === 'failed' || testResult.status === 'timedOut';

            if (failed) {
                rejectRun(new Error(testResult.status));
                await this.adapter.failTest({ runId: this.runId, test, testResult, config });
            } else {
                resolveRun();
                await this.adapter.finishTest({ runId: this.runId, test, testResult, config });
            }
        } catch (error) {
            rejectRun(error as Error);
            throw error;
        } finally {
            this.pool.release(conn);
        }
    }

    private async cleanPreviousRuns() {
        await rm(`./${this.outputFolder}`, { recursive: true, force: true });
    }

    private startTestServer(config: string | undefined): Promise<{ url: string; outputDir: string; kill: () => void }> {
        return new Promise((resolve, reject) => {
            const args = ['playwright', 'test-server'];
            const outputDir = uuid.v7();
            if (config) args.push('--config', config);
            const proc = spawn('npx', args, {
                env: { ...process.env, PLAYWRIGHT_BLOB_OUTPUT_DIR: outputDir },
                stdio: ['ignore', 'pipe', 'inherit'],
                detached: true,
            });

            proc.stdout.on('data', (chunk: Buffer) => {
                const match = chunk.toString().match(/Listening on (ws:\/\/\S+)/);
                if (match) resolve({ url: match[1], outputDir, kill: () => process.kill(-proc.pid!, 'SIGTERM') });
            });

            proc.on('error', reject);
            proc.on('exit', (code) => {
                if (code !== 0) reject(new Error(`test-server exited with code ${code}`));
            });
        });
    }

    private async createTempConfig(runId: string, file: string | undefined): Promise<string | undefined> {
        if (!file) return;
        const content = `import config from '${path.resolve(file)}';
config.webServer = undefined;
export default config;`;
        const tempFile = `.tmp-playwright-${runId}-${uuid.v7()}.config.tmp.ts`;
        await writeFile(tempFile, content);
        return tempFile;
    }
}
