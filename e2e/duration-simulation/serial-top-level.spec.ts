import { test, expect } from '@playwright/test';
import { openTestPage, wait } from '../test-utils.js';

test.describe.configure({ mode: 'serial' });

test('outside of group', { tag: '@duration-simulation' }, async ({ page }) => {
    await openTestPage(page);
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@duration-simulation' }, () => {
    test('inside group', async ({ page }) => {
        await openTestPage(page);
        await wait(2000);
        expect(true).toBeTruthy();
    });
});
