import { test, expect } from '@playwright/test';
import { openTestPage } from '../test-utils';

test.describe.configure({ mode: 'serial' });

test('outside of group', { tag: '@test-simulation' }, async ({ page }) => {
    await openTestPage(page);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async ({ page }) => {
        await openTestPage(page);
        expect(true).toBeTruthy();
    });
});
