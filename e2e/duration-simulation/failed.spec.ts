import { test, expect } from '@playwright/test';
import { openTestPage, wait } from '../test-utils';

test('should failing', { tag: '@duration-simulation' }, async ({ page }) => {
    await openTestPage(page);
    await wait(1000);
    expect(false).toBeTruthy();
});

test('should failing for firefox', { tag: '@duration-simulation' }, async ({ page, browserName }) => {
    await openTestPage(page);
    await wait(1000);
    if (browserName === 'firefox') {
        expect(false).toBeTruthy();
    }
});
