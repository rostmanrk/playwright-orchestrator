import { copyFile } from 'node:fs/promises';

async function generateDiff() {
    await copyFile('node_modules/playwright/lib/runner/testRunner.js', '.patch/testRunner.js');
    await copyFile('.patch/testRunner.js', '.patch/testRunner.patched.js');
}

generateDiff().then();
