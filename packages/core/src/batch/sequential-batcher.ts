import { injectable, inject } from 'inversify';
import type { BatchHandler } from './batch-handler.js';
import type { ShardHandler } from '../adapters/shard-handler.js';
import type { TestItem, TestRunConfig } from '../types/adapters.js';
import { SYMBOLS } from '../symbols.js';

@injectable()
export class SequentialBatcher implements BatchHandler {
    constructor(@inject(SYMBOLS.ShardHandler) private readonly shardHandler: ShardHandler) {}

    async getNextBatch(runId: string, config: TestRunConfig): Promise<TestItem[] | undefined> {
        const test = await this.shardHandler.getNextTest(runId, config);
        return test ? [test] : undefined;
    }
}
