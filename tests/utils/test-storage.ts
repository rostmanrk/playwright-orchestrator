import { expect } from 'vitest';
import { spawnAsync } from '../../packages/core/src/helpers/spawn.js';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import type { Grouping } from '../../packages/core/src/types/adapters.js';
import { TestRunReport } from '../../packages/core/src/types/reporter.js';
import { cliVersion } from '../../packages/core/src/commands/version.js';
import { tmpdir } from 'node:os';
import { globalSetupMarkerFile, globalTeardownMarkerFile } from '../../e2e/globalHooks/constants.mts';

const req = createRequire(join(process.cwd(), 'package.json'));
const orchestratorCli = req.resolve('@playwright-orchestrator/core/cli');
const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');

export async function testStorage(storageOptions: string[], reportsFolder: string, grouping: Grouping) {
    // init command
    const init = await spawnAsync(process.execPath, [orchestratorCli, 'init', ...storageOptions]);
    expect(init.stdout, `Init command failed. Error: ${init.stderr}`).toBeTruthy();

    // create command
    const create = await spawnAsync(process.execPath, [
        orchestratorCli,
        'create',
        ...storageOptions,
        '--batch-mode',
        'count',
        '--batch-target',
        '4',
        '-j',
        '25%', // spawns 2 workers later so in total =50%
        '--config',
        'tests-playwright.config.ts',
        '--grouping',
        grouping,
    ]);
    const runId = create.stdout.trim();
    expect(runId, `Run ID should be truthy. Error: ${create.stderr}`).toBeTruthy();

    // run command
    const command = [orchestratorCli, 'run', ...storageOptions, '--run-id', runId, '--output', reportsFolder];
    const shardIds = ['shard1', 'shard2'];
    const globalMarkerFolder = join(tmpdir(), `playwright-orchestrator-test-${runId}`);
    const beforeRun = Date.now();
    const shardResults = await Promise.all(
        shardIds.map((shardId) =>
            spawnAsync(process.execPath, [...command, '--shard-id', shardId], {
                env: { ...process.env, MARKER_FOLDER: globalMarkerFolder },
            }),
        ),
    );
    const setupMarker = readFileSync(join(globalMarkerFolder, globalSetupMarkerFile), 'utf-8');
    const teardownMarker = readFileSync(join(globalMarkerFolder, globalTeardownMarkerFile), 'utf-8');
    // global setup and teardown + deps should be executed once per shard, so the marker files should contain the number of shards * 2
    expect(setupMarker).toBe((shardIds.length * 2).toString());
    expect(teardownMarker).toBe((shardIds.length * 2).toString());
    expect(
        shardResults.every(({ stderr }) => !stderr.toLocaleLowerCase().includes('error')),
        `Run command failed. Errors: ${shardResults.map(({ stderr }) => stderr).join('\n')}`,
    ).toBeTruthy();
    const afterRun = Date.now();
    const reporterArgs = [
        playwrightCli,
        'merge-reports',
        reportsFolder,
        '--reporter',
        'tests/utils/test-consistent-reporter.ts',
    ];
    const { stdout: mergeStdOut, stderr: mergeStderr } = await spawnAsync(process.execPath, reporterArgs);

    await expect(mergeStdOut, `Merge reports command failed. Error: ${mergeStderr}`).toMatchFileSnapshot(
        '../__snapshots__/test-run.output.snap',
    );

    const { stdout: reportStdout, stderr: reportStderr } = await spawnAsync(process.execPath, [
        orchestratorCli,
        'create-report',
        ...storageOptions,
        '--reporter',
        'json',
        '--run-id',
        runId,
    ]);
    const report: TestRunReport = JSON.parse(reportStdout);
    expect(report.config.version).toBe(cliVersion);
    for (const shardId of shardIds) {
        expect(report.shards).toHaveProperty(shardId);
        const shardInfo = report.shards[shardId];
        expect(shardInfo.started).toBeGreaterThan(beforeRun);
        expect(shardInfo.finished).toBeLessThan(afterRun);
    }

    await expect(
        clearReportForSnapshot(report),
        `Create report command failed. Error: ${reportStderr}`,
    ).toMatchFileSnapshot(`../__snapshots__/test-report-${grouping}.report.snap`);

    // restart command to check if it reruns only failed tests
    await spawnAsync(process.execPath, command);
    const { stdout: mergeStdOut2, stderr: mergeStderr2 } = await spawnAsync(process.execPath, reporterArgs);
    await expect(mergeStdOut2, `Merge reports command failed. Error: ${mergeStderr2}`).toMatchFileSnapshot(
        `../__snapshots__/test-run-repeat-${grouping}.output.snap`,
    );
}

function clearReportForSnapshot(report: TestRunReport) {
    report.tests.sort((a, b) => a.file.localeCompare(b.file) || a.position.localeCompare(b.position));
    const {
        config: { version, workers, ...config },
        tests,
    } = report;
    return JSON.stringify(
        sortObjectProps({
            config,
            tests: tests
                .map((test) => ({ ...test, duration: 0, averageDuration: 0, lastSuccessfulRunTimestamp: 0, fails: 0 }))
                .sort((a, b) => a.title.localeCompare(b.title)),
        }),
        null,
        2,
    );
}

function sortObjectProps(obj: Record<string, any>): any {
    if (typeof obj !== 'object' || obj === null) {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(sortObjectProps);
    }
    return Object.fromEntries(
        Object.entries(obj)
            .map(([key, value]) => [key, sortObjectProps(value)])
            .sort(([keyA], [keyB]) => keyA.localeCompare(keyB)),
    );
}
