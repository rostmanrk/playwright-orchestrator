import { describe, it, expect } from 'vitest';
import { formatElapsed } from '../packages/core/src/reporters/helpers.js';

describe('formatElapsed', () => {
    it('shows one decimal place for under 10 seconds', () => {
        expect(formatElapsed(500)).toBe('0.5s');
        expect(formatElapsed(1200)).toBe('1.2s');
        expect(formatElapsed(9900)).toBe('9.9s');
    });

    it('shows whole seconds for 10s to 59s', () => {
        expect(formatElapsed(10_000)).toBe('10s');
        expect(formatElapsed(45_000)).toBe('45s');
        expect(formatElapsed(59_999)).toBe('59s');
    });

    it('shows minutes only when no remaining seconds', () => {
        expect(formatElapsed(60_000)).toBe('1m');
        expect(formatElapsed(120_000)).toBe('2m');
    });

    it('shows minutes and seconds when seconds remain', () => {
        expect(formatElapsed(90_000)).toBe('1m 30s');
        expect(formatElapsed(330_000)).toBe('5m 30s');
    });
});
