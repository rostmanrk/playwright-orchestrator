import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { globalTeardownMarkerFile } from './constants.mts';

export default async function globalTeardown() {
    const reportFolder = process.env.MARKER_FOLDER;
    if (!reportFolder) return;
    const marker = join(reportFolder, globalTeardownMarkerFile);
    const count = existsSync(marker) ? parseInt(readFileSync(marker, 'utf-8'), 10) + 1 : 1;
    writeFileSync(marker, String(count));
}
