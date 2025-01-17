import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('outside of group', { tag: '@test-simulation' }, async () => {
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async () => {
        expect(true).toBeTruthy();
    });
});
