import { injectable } from 'inversify';
import type { BatchHandler } from './batch-handler.js';
import type { TestItem, TestRunConfig } from '../types/adapters.js';

@injectable()
export class CountBatchHandler implements BatchHandler {
    getNextBatch(_runId: string, _config: TestRunConfig): Promise<TestItem[] | undefined> {
        throw new Error('CountBatchHandler is not implemented yet');
    }
}
