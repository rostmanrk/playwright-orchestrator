import { inject, injectable } from 'inversify';
import type { ShardHandler } from '../adapters/shard-handler.js';
import { Grouping, TestItem, TestRunConfig } from '../types/adapters.js';
import { SYMBOLS } from '../symbols.js';

@injectable()
export class BaseBatchHandler {
    @inject(SYMBOLS.ShardHandler)
    private readonly shardHandler!: ShardHandler;

    async getNextTest(runId: string, config: TestRunConfig, project?: string): Promise<TestItem | undefined> {
        if (config.options.grouping === Grouping.Test || !project)
            return await this.shardHandler.getNextTest(runId, config);
        return await this.shardHandler.getNextTestByProject(runId, project);
    }
}
