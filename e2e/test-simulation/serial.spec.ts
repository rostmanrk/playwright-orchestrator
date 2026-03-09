import { id } from '@playwright-orchestrator/core/annotations';
import { test, expect } from '@playwright/test';

test('outside of group', { tag: '@test-simulation' }, async ({ page }) => {
    await page.goto('https://playwright.dev');
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async ({ page }) => {
        await page.goto('https://playwright.dev');
        expect(true).toBeTruthy();
    });
    test.describe('nested group', { annotation: id('#serial_id') }, () => {
        test.describe.configure({ mode: 'serial' });
        test('inside nested group 1', async ({ page }) => {
            test.setTimeout(40_000);
            await page.goto('https://playwright.dev');
            expect(true).toBeTruthy();
        });
        test('inside nested group 2', async ({ page }) => {
            test.setTimeout(45_000);
            await page.goto('https://playwright.dev');
            expect(true).toBeTruthy();
        });
    });
});
