import { test, expect } from '@playwright/test';

test('should failing', { tag: '@test-simulation' }, async ({ page }, testInfo) => {
    expect(false).toBeTruthy();
});
