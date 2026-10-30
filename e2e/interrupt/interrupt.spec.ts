import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Records the worker and Playwright runner pids so the test can tell that both exited, then waits to be interrupted
test('waits for interrupt', async () => {
    await writeFile(process.env.INTERRUPT_MARKER!, JSON.stringify({ worker: process.pid, runner: process.ppid }));
    await new Promise((resolve) => setTimeout(resolve, 60_000));
});
