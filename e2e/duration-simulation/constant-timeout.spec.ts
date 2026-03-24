import { test, expect } from '@playwright/test';
import { openTestPage, wait } from '../test-utils.js';

test('timeout outside of group', { tag: '@duration-simulation' }, async ({ page }) => {
    test.setTimeout(40_000);
    await openTestPage(page);
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('timeout group', { tag: '@duration-simulation' }, () => {
    test.setTimeout(45_000);
    test('inside group', async ({ page }) => {
        await openTestPage(page);
        await wait(4000);
        expect(true).toBeTruthy();
    });
    test('inside group override timeout', async ({ page }) => {
        test.setTimeout(50_000);
        await openTestPage(page);
        await wait(5000);

        expect(true).toBeTruthy();
    });
    test.describe('nested timeout group', () => {
        test('inside nested group and slow', async ({ page }) => {
            test.slow();
            await openTestPage(page);
            await wait(7000);
            expect(true).toBeTruthy();
        });
    });
});
