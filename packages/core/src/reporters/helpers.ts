import { TestReport } from '../types/reporter.js';

export function calculateTrend(test: TestReport) {
    const trend = test.averageDuration - test.duration;
    return {
        trend,
        trendIcon: trend > 0 ? '📈' : '📉',
        percentage: ((trend / test.averageDuration) * 100).toFixed(2),
    };
}

export function formatDuration(ms: number) {
    if (ms === 0) return '0 seconds';

    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

    const parts = [];
    if (hours) parts.push(`${hours} ${hours === 1 ? 'hour' : 'hours'}`);
    if (minutes) parts.push(`${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`);
    if (seconds) parts.push(`${seconds} ${seconds === 1 ? 'second' : 'seconds'}`);

    return parts.join(', ');
}
