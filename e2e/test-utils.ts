import { expect, Page } from '@playwright/test';

export async function wait(timeout: number) {
    await new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}

export async function openTestPage(page: Page) {
    await page.goto('/');
    expect(await page.title()).toBe('Test Page');
    await expect(page.getByText('Hello from webServer')).toBeVisible();
}
