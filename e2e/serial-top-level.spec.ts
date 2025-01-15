import { test, expect } from '@playwright/test';
import { wait } from '../tests/test-utils';

test.describe.configure({ mode: 'serial' });

test('outside of group', { tag: '@analyzer' }, async () => {
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@analyzer' }, () => {
    test('inside group', async () => {
        await wait(2000);
        expect(true).toBeTruthy();
    });
});
