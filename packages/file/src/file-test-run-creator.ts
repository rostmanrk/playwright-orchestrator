import { injectable, inject } from 'inversify';
import { BaseTestRunCreator, TestStatus, RunStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestSortItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FILE_CONFIG } from './symbols.js';
import { getRunIdFilePath, getRunConfigPath, getHistoryRunPath, getResultsRunPath } from './file-paths.js';

interface TestHistoryItem {
    ema: number;
    created: number;
    history: {
        duration: number;
        updated: number;
        status: TestStatus;
    }[];
}

@injectable()
export class FileTestRunCreator extends BaseTestRunCreator {
    private readonly dir: string;

    constructor(@inject(FILE_CONFIG) createArgs: CreateArgs) {
        super();
        this.dir = createArgs.directory;
    }

    override get reverseSortOrder(): boolean {
        return true;
    }

    async loadTestInfos(tests: TestItem[]): Promise<Map<string, TestSortItem>> {
        await mkdir(this.dir, { recursive: true });
        const history: Record<string, TestHistoryItem> = !existsSync(getHistoryRunPath(this.dir))
            ? {}
            : JSON.parse(await readFile(getHistoryRunPath(this.dir), 'utf-8'));
        for (const t of tests) {
            if (!history[t.testId]) {
                history[t.testId] = {
                    ema: 0,
                    created: Date.now(),
                    history: [],
                };
            }
        }
        await writeFile(getHistoryRunPath(this.dir), JSON.stringify(history, null, 2));
        return new Map(
            Object.entries(history).map(([testId, { ema, history }]) => [
                testId,
                { ema, fails: history.filter((h) => h.status === TestStatus.Failed).length },
            ]),
        );
    }

    async saveRunData(runId: string, config: object, tests: TestItem[]): Promise<void> {
        const testConfig: TestRunConfig = {
            ...(config as TestRunConfig),
            status: RunStatus.Created,
            updated: Date.now(),
        };
        await writeFile(getRunConfigPath(this.dir, runId), JSON.stringify(testConfig, null, 2));
        await writeFile(getRunIdFilePath(this.dir, runId), JSON.stringify(tests, null, 2));
        await writeFile(getResultsRunPath(this.dir, runId), '[]');
    }
}
