import * as core from '@actions/core';
import { TestRunReport } from '../types/reporter.js';
import { TestStatus } from '../types/test-info.js';
import { calculateTrend, extractShardRunInfo, formatDuration } from './helpers.js';

export async function ghaReporter(data: TestRunReport) {
    const { tests } = data;
    await core.summary
        .addHeading(`🏃 Test run summary`)
        .addDetails('Run config', buildConfigData(data))
        .addDetails(...buildShardInfo(data))
        .addTable([
            [
                { data: '', header: true },
                { data: '📁 Projects', header: true },
                { data: '📝 Test Id', header: true },
                { data: '⏱️ Duration', header: true },
                { data: '📊 Trend', header: true },
                { data: '✨ Last successful run', header: true },
                { data: '❌ Fails', header: true },
            ],
            ...tests.map((test) => {
                const { percentage, trendIcon } = calculateTrend(test);
                return [
                    test.status === TestStatus.Passed ? '✅' : '❌',
                    test.projects.join(' | '),
                    test.title,
                    formatDuration(test.duration),
                    `${trendIcon} ${percentage}%`,
                    test.lastSuccessfulRunTimestamp
                        ? new Date(test.lastSuccessfulRunTimestamp).toLocaleString()
                        : 'N/A',
                    test.fails.toString(),
                ];
            }),
        ])
        .write();
}

function buildShardInfo(report: TestRunReport) {
    const shardInfo = extractShardRunInfo(report);
    const durations = shardInfo.map((s) => s.duration).filter((d): d is number => d !== null);
    const sumDuration = durations.reduce((a, b) => a + b, 0);
    const maxDuration = durations.length ? Math.max(...durations) : 0;
    const minDuration = durations.length ? Math.min(...durations) : 0;
    const measuredShardsCount = durations.length;
    const avgDuration = measuredShardsCount > 0 ? sumDuration / measuredShardsCount : 0;
    const discrepancyPercent =
        measuredShardsCount > 1 && avgDuration > 0 ? ((maxDuration - minDuration) / avgDuration) * 100 : 0;
    return [
        `Average shard duration: ${formatDuration(avgDuration)} | Shard discrepancy: ${discrepancyPercent.toFixed(2)}%`,
        `
<table>
<tr><td>Shard Id</td><td>Started</td><td>Finished</td><td>Duration</td></tr>
${shardInfo
    .map(
        ({ shardId, started, finished, duration }) =>
            `<tr><td>${shardId}</td><td>${started}</td><td>${finished ? new Date(finished).toLocaleString() : 'N/A'}</td><td>${duration !== null ? formatDuration(duration) : 'N/A'}</td></tr>`,
    )
    .join('')}
</table>
    `,
    ] as const;
}

function buildConfigData({
    config: {
        options: { historyWindow, batchMode, grouping, batchTarget },
        workers,
        version,
    },
    runId,
}: TestRunReport) {
    return `
<table>
<tr><td>PW Orchestrator Version</td><td>${version}</td></tr>
<tr><td>Run Id</td><td>${runId}</td></tr>
<tr><td>History Window</td><td>${historyWindow}</td></tr>
<tr><td>Grouping</td><td>${grouping}</td></tr>
<tr><td>Batch Mode</td><td>${batchMode}</td></tr>
<tr><td>Batch Target</td><td>${batchTarget}</td></tr>
<tr><td>Workers Per Shard</td><td>${workers}</td></tr>
</table>`;
}
