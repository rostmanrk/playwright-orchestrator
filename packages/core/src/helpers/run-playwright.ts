import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function runPlaywright(
    args: string[],
    onLine?: (line: string, isError: boolean) => void,
    env?: NodeJS.ProcessEnv,
): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const proc = spawn('npx', ['playwright', 'test', ...args], {
            env: env ?? process.env,
            stdio: ['ignore', onLine ? 'pipe' : 'ignore', onLine ? 'pipe' : 'ignore'],
        });
        if (onLine) {
            createInterface({ input: proc.stdout!, crlfDelay: Infinity }).on('line', (line) => onLine(line, false));
            createInterface({ input: proc.stderr!, crlfDelay: Infinity }).on('line', (line) => onLine(line, true));
        }
        proc.on('exit', resolve);
        proc.on('error', reject);
    });
}
