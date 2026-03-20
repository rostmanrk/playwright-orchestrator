import { inject, injectable, injectFromBase } from 'inversify';
import type { BatchHandler } from './batch-handler.js';
import type { TestItem, TestRunConfig } from '../types/adapters.js';
import { BaseBatchHandler } from './base-batch-handler.js';

const THRESHOLD = 0.1;

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
export class TimeBatchHandler extends BaseBatchHandler implements BatchHandler {
    async getNextBatch(runId: string, config: TestRunConfig): Promise<TestItem[] | undefined> {
        const batch: TestItem[] = [];
        let budget = config.options.batchTarget! * 1000;
        const threshold = budget * THRESHOLD;
        let test: TestItem | undefined;
        while (budget + threshold > (test?.ema ?? 0)) {
            test = await this.getNextTest(runId, config, test?.projects[0]);
            if (!test) break;
            batch.push(test);
            budget -= test.ema;
        }

        return batch.length > 0 ? batch : undefined;
    }
}
