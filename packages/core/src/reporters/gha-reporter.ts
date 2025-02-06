import * as core from '@actions/core';
import { TestRunReport } from '../types/reporter.js';
import { TestStatus } from '../types/test-info.js';
import { calculateTrend, formatDuration } from './helpers.js';

export async function ghaReporter(data: TestRunReport) {
    const { config, runId, tests } = data;
    await core.summary
        .addHeading(`🏃 Test run summary`)
        .addDetails('Run config', buildConfigData(data))
        .addTable([
            [
                { data: '', header: true },
                { data: '📁 Project', header: true },
                { data: '📝 Title', header: true },
                { data: '⏱️ Duration', header: true },
                { data: '📊 Trend', header: true },
                { data: '✨ Last successful run', header: true },
                { data: '❌ Fails', header: true },
            ],
            ...tests.map((test) => {
                const { percentage, trendIcon } = calculateTrend(test);
                return [
                    test.status === TestStatus.Passed ? '✅' : '❌',
                    test.project,
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

function buildConfigData({ config, runId }: TestRunReport) {
    return `
<table>
<tr><td>Run Id</td><td>${runId}</td></tr>    
<tr><td>History Window</td><td>${config.historyWindow}</td></tr>    
</table>`;
}
