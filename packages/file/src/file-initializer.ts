import { injectable } from 'inversify';
import type { Initializer } from '@playwright-orchestrator/core';

@injectable()
export class FileInitializer implements Initializer {
    async initialize(): Promise<void> {}
}
