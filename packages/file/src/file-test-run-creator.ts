import { injectable, inject, injectFromBase } from 'inversify';
import { BaseTestRunCreator, TestStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestSortItem, TestRun } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { FILE_CONFIG } from './symbols.js';
import { getRunIdFilePath, getRunConfigPath, getHistoryRunPath, getResultsRunPath } from './file-paths.js';
import { TestHistoryItem } from './types.js';

@injectable()
@injectFromBase({ extendProperties: true, extendConstructorArguments: false })
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

    async saveRunData(runId: string, testRun: TestRun, tests: TestItem[]): Promise<void> {
        await writeFile(getRunConfigPath(this.dir, runId), JSON.stringify(testRun, null, 2));
        await writeFile(getRunIdFilePath(this.dir, runId), JSON.stringify(tests, null, 2));
        await writeFile(getResultsRunPath(this.dir, runId), '[]');
    }
}
