import { test, expect } from '@playwright/test';

test('outside of group', { tag: '@test-simulation' }, async function () {
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async () => {
        expect(true).toBeTruthy();
    });
});
