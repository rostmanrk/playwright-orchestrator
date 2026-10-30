import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: '.',
    workers: 1,
    timeout: 60_000,
    projects: [{ name: 'node' }],
});
