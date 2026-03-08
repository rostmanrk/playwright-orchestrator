import { injectable } from 'inversify';
import type { Initializer } from '@playwright-orchestrator/core';

@injectable()
export class RedisInitializer implements Initializer {
    async initialize(): Promise<void> {}
}
