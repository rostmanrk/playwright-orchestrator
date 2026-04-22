import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const req = createRequire(join(process.cwd(), 'package.json'));
const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');

export function runPlaywright(
    args: string[],
    onLine?: (line: string, isError: boolean) => void,
    env?: NodeJS.ProcessEnv,
): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [playwrightCli, 'test', ...args], {
            env: env ?? process.env,
            stdio: ['ignore', onLine ? 'pipe' : 'ignore', onLine ? 'pipe' : 'ignore'],
        });
        if (onLine) {
            createInterface({ input: proc.stdout!, crlfDelay: Infinity }).on('line', (line) => onLine(line, false));
            createInterface({ input: proc.stderr!, crlfDelay: Infinity }).on('line', (line) => onLine(line, true));
        }
        proc.on('close', resolve);
        proc.on('error', reject);
    });
}
