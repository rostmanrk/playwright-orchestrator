import { test } from '@playwright/test';
import { rename, writeFile } from 'node:fs/promises';

// In the shard that gets killed, records the worker and Playwright runner pids and waits to be killed.
// When the repeat run queues it again, it passes.
test('runs again after its shard is killed', async () => {
    const marker = process.env.ABANDONED_MARKER;
    if (!marker) return;
    // Renamed into place, so the marker never exists half written
    await writeFile(`${marker}.tmp`, JSON.stringify({ worker: process.pid, runner: process.ppid }));
    await rename(`${marker}.tmp`, marker);
    await new Promise((resolve) => setTimeout(resolve, 60_000));
});
