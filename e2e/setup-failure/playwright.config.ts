import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    globalSetup: './global-setup.ts',
    globalTeardown: './global-teardown.ts',
    projects: [{ name: 'node' }],
});
