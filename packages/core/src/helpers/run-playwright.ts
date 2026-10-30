import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';

const req = createRequire(join(process.cwd(), 'package.json'));
const playwrightCli = join(dirname(req.resolve('@playwright/test/package.json')), 'cli.js');

export const playwrightVersion = (req('@playwright/test/package.json') as { version: string }).version;

/** `--test-list` exists since Playwright 1.56 */
export function supportsTestList(): boolean {
    const [major, minor] = playwrightVersion.split('.').map(Number);
    return major > 1 || (major === 1 && minor >= 56);
}

export function runPlaywright(
    args: string[],
    onLine?: (line: string, isError: boolean) => void,
    env?: NodeJS.ProcessEnv,
    signal?: AbortSignal,
): Promise<number | null> {
    if (signal?.aborted) return Promise.resolve(null);
    return new Promise((resolve, reject) => {
        const proc = spawn(process.execPath, [playwrightCli, 'test', ...args], {
            env: env ?? process.env,
            stdio: ['ignore', onLine ? 'pipe' : 'ignore', onLine ? 'pipe' : 'ignore'],
        });
        if (onLine) {
            createInterface({ input: proc.stdout!, crlfDelay: Infinity }).on('line', (line) => onLine(line, false));
            createInterface({ input: proc.stderr!, crlfDelay: Infinity }).on('line', (line) => onLine(line, true));
        }
        // SIGINT makes Playwright stop gracefully: it reports running tests as interrupted and writes its reports
        const interrupt = () => proc.kill('SIGINT');
        signal?.addEventListener('abort', interrupt, { once: true });
        proc.on('close', (code) => {
            signal?.removeEventListener('abort', interrupt);
            resolve(code);
        });
        proc.on('error', (err) => {
            signal?.removeEventListener('abort', interrupt);
            reject(err);
        });
    });
}
