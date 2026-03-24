import { test, expect } from '@playwright/test';
import { openTestPage } from '../test-utils';

test('should failing', { tag: '@test-simulation' }, async ({ page }) => {
    await openTestPage(page);
    expect(false).toBeTruthy();
});
