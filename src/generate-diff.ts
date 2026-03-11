import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

async function prepareDiff() {
    const a = spawnSync('git', ['diff', '--no-index', '-u', '.patch/testRunner.js', '.patch/testRunner.patched.js'], {
        stdio: 'pipe',
    });
    const patch = a.stdout
        .toString()
        .split('\n')
        .filter((line) => !line.startsWith('diff --git') && !line.startsWith('index '))
        .join('\n');
    await writeFile('packages/core/patches/playwright.patch', patch);
}

prepareDiff().then();
