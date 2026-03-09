import { test, expect } from '@playwright/test';

test('timeout outside of group', { tag: '@test-simulation' }, async ({ page }) => {
    test.setTimeout(40_000);
    await page.goto('https://playwright.dev');
    expect(true).toBeTruthy();
});

test.describe('timeout group', { tag: '@test-simulation' }, () => {
    test.setTimeout(45_000);
    test('inside group', async ({ page }) => {
        await page.goto('https://playwright.dev');
        expect(true).toBeTruthy();
    });
    test('inside group override timeout', async function ({ page }) {
        test.setTimeout(50_000);
        await page.goto('https://playwright.dev');
        expect(true).toBeTruthy();
    });
    test.describe('nested timeout group', () => {
        test('inside nested group and slow', async ({ page }) => {
            test.slow();
            await page.goto('https://playwright.dev');
            expect(true).toBeTruthy();
        });
    });
});
