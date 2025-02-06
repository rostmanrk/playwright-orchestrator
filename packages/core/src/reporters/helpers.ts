import { TestReport } from '../types/reporter.js';

export function calculateTrend(test: TestReport) {
    const trend = test.averageDuration - test.duration;
    return {
        trend,
        trendIcon: trend > 0 ? '📈' : '📉',
        percentage: ((trend / test.averageDuration) * 100).toFixed(1),
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
