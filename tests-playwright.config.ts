import config from './playwright.config';

config.testDir = './e2e/test-simulation';
config.globalSetup = require.resolve('./e2e/globalHooks/global-setup.mts');
config.globalTeardown = require.resolve('./e2e/globalHooks/global-teardown.mts');
export default config;
