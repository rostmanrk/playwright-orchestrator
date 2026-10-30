import { randomUUID } from 'node:crypto';
import { open, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { lock } from 'proper-lockfile';

/**
 * Locks are held for a few milliseconds, so retry every 50-100ms. The default backoff starts at 1s and doubles,
 * which made shards wait seconds for each other. Retries span at least 20s, longer than the 10s after which
 * a lock left by a crashed process counts as stale.
 */
const LOCK_RETRIES = { retries: 200, minTimeout: 50, maxTimeout: 100, randomize: true };

/**
 * Runs the action while holding a cross-process lock on the file.
 * The file must exist, since the lock path is resolved through realpath.
 */
export async function withLock<T>(file: string, action: () => Promise<T>): Promise<T> {
    const release = await lock(file, { retries: LOCK_RETRIES });
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
