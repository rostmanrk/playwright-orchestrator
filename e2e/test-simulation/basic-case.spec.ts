import { test, expect } from '@playwright/test';
import { openTestPage } from '../test-utils';

test('outside of group', { tag: '@test-simulation' }, async function ({ page }) {
    await openTestPage(page);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async ({ page }) => {
        await openTestPage(page);
        expect(true).toBeTruthy();
    });
});
