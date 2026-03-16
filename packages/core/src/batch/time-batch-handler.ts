import { injectable } from 'inversify';
import type { BatchHandler } from './batch-handler.js';
import type { TestItem } from '../types/adapters.js';
import type { TestRunConfig } from '../types/test-info.js';

@injectable()
export class TimeBatchHandler implements BatchHandler {
    getNextBatch(_runId: string, _config: TestRunConfig): Promise<TestItem[] | undefined> {
        throw new Error('TimeBatchHandler is not implemented yet');
    }
}
