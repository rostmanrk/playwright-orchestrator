import { test, expect } from '@playwright/test';
import { openTestPage, wait } from '../test-utils';

const scenarios = [
    { name: 'first', value: 1 },
    { name: 'second', value: 0 },
    { name: 'third', value: 2 },
];

for (const scenario of scenarios) {
    test(`runs ${scenario.name} case`, { tag: '@duration-simulation' }, async ({ page }) => {
        await openTestPage(page);
        await wait(1000);
        expect(scenario.value).toBeGreaterThan(0);
    });
}
