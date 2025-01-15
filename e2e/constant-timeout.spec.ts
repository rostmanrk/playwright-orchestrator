import { test, expect } from '@playwright/test';
import { wait } from '../tests/test-utils';

test('timeout outside of group', { tag: '@analyzer' }, async () => {
    test.setTimeout(40_000);
    await wait(3000);
    expect(true).toBeTruthy();
});

test.describe('timeout group', { tag: '@analyzer' }, () => {
    test.setTimeout(45_000);
    test('inside group', async () => {
        await wait(4000);
        expect(true).toBeTruthy();
    });
    test('inside group override timeout', async function () {
        test.setTimeout(50_000);
        await wait(5000);

        expect(true).toBeTruthy();
    });
    test.describe('nested timeout group', () => {
        test('inside nested group and slow', async () => {
            test.slow();
            await wait(7000);
            expect(true).toBeTruthy();
        });
    });
});
