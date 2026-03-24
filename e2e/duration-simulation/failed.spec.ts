import { test, expect } from '@playwright/test';
import { openTestPage, wait } from '../test-utils';

test('should failing', { tag: '@duration-simulation' }, async ({ page }) => {
    await openTestPage(page);
    await wait(1000);
    expect(true).toBe(false);
});
