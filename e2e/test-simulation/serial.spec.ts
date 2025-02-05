import { id } from '@playwright-orchestrator/core/annotations';
import { test, expect } from '@playwright/test';

test('outside of group', { tag: '@test-simulation' }, async () => {
    expect(true).toBeTruthy();
});

test.describe('group', { tag: '@test-simulation' }, () => {
    test('inside group', async () => {
        expect(true).toBeTruthy();
    });
    test.describe('nested group', { annotation: id('#serial_id') }, () => {
        test.describe.configure({ mode: 'serial' });
        test('inside nested group 1', async () => {
            test.setTimeout(40_000);
            expect(true).toBeTruthy();
        });
        test('inside nested group 2', async () => {
            test.setTimeout(45_000);
            expect(true).toBeTruthy();
        });
    });
});
