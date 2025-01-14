import { test, expect } from '@playwright/test';
import { wait } from '../../tests/test-utils';

test('outside of group', { tag: '@analyzer' }, async function () {
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@analyzer' }, () => {
    test('inside group', async () => {
        await wait(3000);
        expect(true).toBeTruthy();
    });
});
