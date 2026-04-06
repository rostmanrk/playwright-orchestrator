import { injectable, injectFromBase } from 'inversify';
import type { BatchHandler } from './batch-handler.js';
import type { TestItem, TestRunConfig } from '../types/adapters.js';
import { BaseBatchHandler } from './base-batch-handler.js';

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
export class CountBatchHandler extends BaseBatchHandler implements BatchHandler {
    async getNextBatch(config: TestRunConfig): Promise<TestItem[] | undefined> {
        const batch: TestItem[] = [];
        let test: TestItem | undefined;
        for (let i = 0; i < config.options.batchTarget!; i++) {
            test = await this.getNextTest(config, test?.projects[0]);
            if (!test) break;
            batch.push(test);
        }

        return batch.length > 0 ? batch : undefined;
    }
}
