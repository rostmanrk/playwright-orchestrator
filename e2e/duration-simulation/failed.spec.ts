import { test, expect } from '@playwright/test';
import { wait } from '../test-utils';

test('should failing', { tag: '@duration-simulation' }, async ({ page }, testInfo) => {
    await wait(1000);
    expect(true).toBe(false);
});
