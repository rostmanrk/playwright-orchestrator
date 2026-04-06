import { inject, injectable } from 'inversify';
import type { ShardHandler } from '../adapters/shard-handler.js';
import type { TestItem, TestRunConfig } from '../types/adapters.js';
import { Grouping } from '../types/adapters.js';
import { SYMBOLS } from '../symbols.js';

@injectable()
export class BaseBatchHandler {
    @inject(SYMBOLS.ShardHandler)
    private readonly shardHandler!: ShardHandler;

    async getNextTest(config: TestRunConfig, project?: string): Promise<TestItem | undefined> {
        if (config.options.grouping === Grouping.Test || !project) return await this.shardHandler.getNextTest(config);
        return await this.shardHandler.getNextTestByProject(project);
    }
}
