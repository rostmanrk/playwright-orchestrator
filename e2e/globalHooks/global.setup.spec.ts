import { test as setup } from '@playwright/test';
import globalSetup from './global-setup.mts';

setup('setup', async ({}) => {
    await globalSetup();
});
