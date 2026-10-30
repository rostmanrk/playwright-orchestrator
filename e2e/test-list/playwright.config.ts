import { defineConfig } from '@playwright/test';

// Only listed, never run: checks that each test's --test-list entry selects exactly that test
export default defineConfig({
    testDir: '.',
    projects: [{ name: 'chromium' }, { name: 'firefox' }],
});
