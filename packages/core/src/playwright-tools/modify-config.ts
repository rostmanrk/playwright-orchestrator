import { PlaywrightTestConfig } from '@playwright/test';
import { writeFile } from 'fs/promises';
import * as path from 'path';
import { dynamicImport } from './dynamic-import';

export { defineConfig } from '@playwright/test';

export async function createTempConfig(file?: string): Promise<string | undefined> {
    if (!file) return;
    const config = (await dynamicImport(file)).default as PlaywrightTestConfig;
    // Remove webServer from the config. Not supported in the orchestrator
    delete config.webServer;
    const tempFile = path.join(path.dirname(file), `playwright-config-${Date.now()}.js`);
    const configContent = `
        exports.default = ${JSON.stringify(config, null, 2)};
    `;
    await writeFile(tempFile, configContent);
    return tempFile;
}
