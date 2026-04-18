import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { globalSetupMarkerFile } from './constants.mts';

export default async function globalSetup() {
    const reportFolder = process.env.MARKER_FOLDER;
    if (!reportFolder) return;
    mkdirSync(reportFolder, { recursive: true });
    const marker = join(reportFolder, globalSetupMarkerFile);
    const count = existsSync(marker) ? parseInt(readFileSync(marker, 'utf-8'), 10) + 1 : 1;
    writeFileSync(marker, String(count));
}
