import { test, expect } from '@playwright/test';
import { openTestPage } from '../test-utils';

const scenarios = [
    { name: 'first', value: 1 },
    { name: 'second', value: 0 },
    { name: 'third', value: 2 },
];

for (const scenario of scenarios) {
    test(`runs ${scenario.name} case`, { tag: '@test-simulation' }, async ({ page }) => {
        await openTestPage(page);
        expect(scenario.value).toBeGreaterThan(0);
    });
}
