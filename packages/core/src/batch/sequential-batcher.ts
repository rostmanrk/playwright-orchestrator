import { injectable, injectFromBase } from 'inversify';
import type { BatchHandler } from './batch-handler.js';
import type { TestItem, TestRunConfig } from '../types/adapters.js';
import { BaseBatchHandler } from './base-batch-handler.js';

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
export class SequentialBatcher extends BaseBatchHandler implements BatchHandler {
    async getNextBatch(config: TestRunConfig): Promise<TestItem[] | undefined> {
        const test = await this.getNextTest(config);
        return test ? [test] : undefined;
    }
}
