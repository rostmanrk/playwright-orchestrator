import { test, expect } from '@playwright/test';
import { openTestPage } from '../test-utils';

test('should failing', { tag: '@test-simulation' }, async ({ page }) => {
    await openTestPage(page);
    expect(false).toBeTruthy();
});

test('should failing for firefox', { tag: '@test-simulation' }, async ({ page, browserName }) => {
    await openTestPage(page);
    if (browserName === 'firefox') {
        expect(false).toBeTruthy();
    }
});
