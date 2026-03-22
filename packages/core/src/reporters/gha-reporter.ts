import * as core from '@actions/core';
import { TestRunReport } from '../types/reporter.js';
import { TestStatus } from '../types/test-info.js';
import { calculateTrend, formatDuration } from './helpers.js';

export async function ghaReporter(data: TestRunReport) {
    const { tests } = data;
    await core.summary
        .addHeading(`🏃 Test run summary`)
        .addDetails('Run config', buildConfigData(data))
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

function buildConfigData({
    config: {
        options: { historyWindow },
    },
    runId,
}: TestRunReport) {
    return `
<table>
<tr><td>Run Id</td><td>${runId}</td></tr>    
<tr><td>History Window</td><td>${historyWindow}</td></tr>    
</table>`;
}
