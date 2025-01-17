import { test, expect } from '@playwright/test';
import { wait } from '../test-utils';

test('outside of group', { tag: '@duration-simulation' }, async function () {
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@duration-simulation' }, () => {
    test('inside group', async () => {
        await wait(3000);
        expect(true).toBeTruthy();
    });
});
