import type { TestRunInfo } from '../types/test-info.js';

export interface RunInfoLoader {
    load(args: string[]): Promise<TestRunInfo>;
}
