import * as core from '@actions/core';
import { TestRunReport } from '../types/reporter.js';
import { TestStatus } from '../types/test-info.js';
import { calculateTrend, formatDuration } from './helpers.js';

export function ghaReporter({ config, runId, tests }: TestRunReport) {
    core.summary.addHeading(`🏃 Test run ${runId} summary. History window: ${config.historyWindow}`).addTable([
        [
            { data: '', header: true },
            { data: '📝 Title', header: true },
            { data: '📄 File', header: true },
            { data: '📁 Project', header: true },
            { data: '⏱️ Duration', header: true },
            { data: '📊 Trend', header: true },
            { data: '✨ Last successful run', header: true },
            { data: '❌ Fails', header: true },
        ],
        ...tests.map((test) => {
            const { percentage, trendIcon } = calculateTrend(test);
            return [
                test.status === TestStatus.Passed ? '✅' : '❌',
                test.title,
                test.file,
                test.project,
                formatDuration(test.duration),
                `${trendIcon} ${percentage}%`,
                test.lastSuccessfulRunTimestamp ? new Date(test.lastSuccessfulRunTimestamp).toLocaleString() : 'N/A',
                test.fails.toString(),
            ];
        }),
    ]);
}
