import { test, expect } from '@playwright/test';

test('should failing', { tag: '@test-simulation' }, async ({ page }, testInfo) => {
    await page.goto('https://duckduckgo.com/');
    await page.getByPlaceholder('Search without being tracked').fill('should failing');
    await page.click('invalid', { timeout: 200 });
    expect(true).toBeTruthy();
});
