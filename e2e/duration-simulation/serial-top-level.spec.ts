import { test, expect } from '@playwright/test';
import { wait } from '../test-utils.js';

test.describe.configure({ mode: 'serial' });

test('outside of group', { tag: '@duration-simulation' }, async () => {
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@duration-simulation' }, () => {
    test('inside group', async () => {
        await wait(2000);
        expect(true).toBeTruthy();
    });
});
