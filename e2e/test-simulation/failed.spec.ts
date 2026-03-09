import { test, expect } from '@playwright/test';

test('should failing', { tag: '@test-simulation' }, async ({ page }, testInfo) => {
    await page.goto('https://playwright.dev');
    expect(false).toBeTruthy();
});
