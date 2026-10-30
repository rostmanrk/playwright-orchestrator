import { test } from '@playwright/test';

// Titles where one ends with another used to select both tests
for (const role of ['admin', 'super admin']) {
    test(`${role} can login`, async () => {});
}

test.describe('reports', () => {
    test('export', async () => {});
});

test('csv export', async () => {});

test.describe('checkout', () => {
    test.describe.configure({ mode: 'serial' });
    test('add to cart', async () => {});
    test('pay', async () => {});
});

test('title with > in it', async () => {});
