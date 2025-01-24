import { writeFile } from 'fs/promises';
import * as path from 'path';
import * as uuid from 'uuid';

export async function createTempConfig(file: string | undefined): Promise<string | undefined> {
    if (!file) return;
    // Remove webServer from the config. Not supported in the orchestrator
    const content = `
    import config from '${path.resolve(file)}';
    delete config.webServer;
    export default config;`;

    const tempFile = `.playwright-${uuid.v7()}.config.tmp.ts`;
    await writeFile(tempFile, content);
    return tempFile;
}
