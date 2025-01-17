import { test, expect } from '@playwright/test';

test('timeout outside of group', { tag: '@test-simulation' }, async () => {
    test.setTimeout(40_000);
    expect(true).toBeTruthy();
});

test.describe('timeout group', { tag: '@test-simulation' }, () => {
    test.setTimeout(45_000);
    test('inside group', async () => {
        expect(true).toBeTruthy();
    });
    test('inside group override timeout', async function () {
        test.setTimeout(50_000);

        expect(true).toBeTruthy();
    });
    test.describe('nested timeout group', () => {
        test('inside nested group and slow', async () => {
            test.slow();
            expect(true).toBeTruthy();
        });
    });
});
