import { test, expect } from '@playwright/test';
import { wait } from '../test-utils.js';

test('outside of group', { tag: '@duration-simulation' }, async () => {
    await wait(2000);
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@duration-simulation' }, () => {
    test('inside group', async () => {
        await wait(4000);
        expect(true).toBeTruthy();
    });
    test.describe('nested group', () => {
        test.describe.configure({ mode: 'serial' });
        test('inside nested group 1', async () => {
            test.setTimeout(40_000);
            await wait(5000);
            expect(true).toBeTruthy();
        });
        test('inside nested group 2', async () => {
            test.setTimeout(45_000);
            await wait(6000);
            expect(true).toBeTruthy();
        });
    });
});
