import type { ReporterTestRunInfo } from '../types/test-info.js';

export interface RunInfoLoader {
    load(args: string[]): Promise<ReporterTestRunInfo>;
}
