import { TestReport, TestRunReport } from '../types/reporter.js';

export function calculateTrend(test: TestReport) {
    const trend = test.averageDuration - test.duration;
    const numericPercentage = test.averageDuration === 0 ? 0 : (trend / test.averageDuration) * 100;
    const percentage = test.averageDuration === 0 ? 'N/A' : numericPercentage.toFixed(1);
    const absPct = test.averageDuration === 0 ? 0 : Math.abs(numericPercentage);
    const trendIcon = absPct < 1 ? '📊' : trend > 0 ? '📉' : '📈';
    const displayPercentage = percentage === '-0.0' ? '0.0' : percentage;
    return {
        trend,
        trendIcon,
        percentage: displayPercentage,
    };
}

export function formatDuration(ms: number) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

    const parts = [];
    if (hours) parts.push(`${hours} ${hours === 1 ? 'h' : 'hs'}`);
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'min' : 'mins'}`);
    if (parts.length === 0 || seconds) parts.push(`${seconds} ${seconds === 1 ? 'sec' : 'secs'}`);

    return parts.join(', ');
}

export function formatElapsed(ms: number): string {
    if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
    if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
    const m = Math.floor(ms / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

export function extractShardRunInfo(report: TestRunReport) {
    const shards = report.shards ?? {};
    const shardInfo = Object.entries(shards).map(([shardId, { started, finished }]) => ({
        shardId,
        started: new Date(started).toLocaleString(),
        finished,
        duration: finished ? finished - started : null,
    }));
    return shardInfo;
}
