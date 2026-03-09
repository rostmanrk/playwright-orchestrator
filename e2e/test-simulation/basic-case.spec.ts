import { test, expect } from '@playwright/test';

test('outside of group', { tag: '@test-simulation' }, async function ({ page }) {
    await page.goto('https://playwright.dev');
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async ({ page }) => {
        await page.goto('https://playwright.dev');
        expect(true).toBeTruthy();
    });
});
