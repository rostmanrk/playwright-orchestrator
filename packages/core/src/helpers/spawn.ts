import child_process from 'node:child_process';

export async function spawnAsync(command: string, args: string[] = [], options?: child_process.SpawnOptions) {
    return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        const child = child_process.spawn(command, args, options ?? {});

        let stdout = '';
        let stderr = '';

        child.stdout?.on('data', (data) => {
            stdout += data.toString();
        });

        child.stderr?.on('data', (data) => {
            stderr += data.toString();
        });

        child.on('close', (code) => {
            resolve({ stdout, stderr });
        });

        child.on('error', (err) => {
            reject(err);
        });
    });
}
