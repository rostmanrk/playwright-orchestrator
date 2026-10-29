import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lock } from 'proper-lockfile';

/**
 * Runs the action while holding a cross-process lock on the file.
 * The file must exist, since the lock path is resolved through realpath.
 */
export async function withLock<T>(file: string, action: () => Promise<T>): Promise<T> {
    const release = await lock(file, { retries: 100 });
    try {
        return await action();
    } finally {
        await release();
    }
}

/**
 * Writes to a temp file in the same directory, flushes it to disk, then renames it over the target,
 * so readers never observe a partially written file and a crash never leaves the target truncated.
 */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
    const tempFile = `${file}.${process.pid}.${randomUUID()}.tmp`;
    try {
        const handle = await open(tempFile, 'w');
        try {
            await handle.writeFile(data, 'utf-8');
            await handle.sync();
        } finally {
            await handle.close();
        }
        await rename(tempFile, file);
    } catch (error) {
        await rm(tempFile, { force: true });
        throw error;
    }
    await syncDirectory(dirname(file));
}

/** Persists the rename itself. Directories can't be opened for fsync on Windows. */
async function syncDirectory(directory: string): Promise<void> {
    if (process.platform === 'win32') return;
    const handle = await open(directory, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}
