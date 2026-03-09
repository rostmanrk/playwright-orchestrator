import { TestRunConfig } from '@playwright-orchestrator/core';
import { Binary } from 'mongodb';
import * as uuid from 'uuid';
import type { TestRunDocument } from './types.js';

export function generateTestId(runId: string, order: number): Binary {
    const binaryRunId = uuid.parse(runId);
    const orderBytes = new Uint8Array(2);
    orderBytes[0] = (order >> 8) & 0xff;
    orderBytes[1] = order & 0xff;
    const combined = new Uint8Array([...binaryRunId, ...orderBytes]);
    return new Binary(combined, Binary.SUBTYPE_USER_DEFINED);
}

export function generateRunId(runId: string): Binary {
    return new Binary(uuid.parse(runId));
}

export function parseTestId(testId: Binary): { runId: string; order: number } {
    const runId = uuid.stringify(testId.buffer.slice(0, 16));
    const order = (testId.buffer[16] << 8) + testId.buffer[17];
    return { runId, order };
}

export function mapDbToTestRunConfig(run: TestRunDocument): TestRunConfig {
    const { args, config, status, updated, historyWindow } = run;
    return { ...config, args, historyWindow, status, updated: updated.getTime() };
}
