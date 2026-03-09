import type { SaveTestRunParams } from '../types/adapters.js';

export interface TestRunCreator {
    create(params: SaveTestRunParams): Promise<void>;
}
