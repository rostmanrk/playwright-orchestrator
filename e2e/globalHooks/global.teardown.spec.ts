import { test as teardown } from '@playwright/test';
import globalTeardown from './global-teardown.mts';

teardown('teardown', async ({}) => {
    await globalTeardown();
});
