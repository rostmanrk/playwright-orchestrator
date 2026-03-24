import { test, expect } from '@playwright/test';
import { openTestPage } from '../test-utils';

test('timeout outside of group', { tag: '@test-simulation' }, async ({ page }) => {
    test.setTimeout(40_000);
    await openTestPage(page);
    expect(true).toBeTruthy();
});

test.describe('timeout group', { tag: '@test-simulation' }, () => {
    test.setTimeout(45_000);
    test('inside group', async ({ page }) => {
        await openTestPage(page);
        expect(true).toBeTruthy();
    });
    test('inside group override timeout', async function ({ page }) {
        test.setTimeout(50_000);
        await openTestPage(page);
        expect(true).toBeTruthy();
    });
    test.describe('nested timeout group', () => {
        test('inside nested group and slow', async ({ page }) => {
            test.slow();
            await openTestPage(page);
            expect(true).toBeTruthy();
        });
    });
});
