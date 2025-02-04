import { TestItem, TestReportResult, TestSortItem, TestStatus } from '@playwright-orchestrator/core';
import { Fields, OFFSET_STEP, StatusOffset } from './constants.js';
import { DynamoResultTestParams, TestInfoItem, TestItemDb, TestReport } from './types.js';

export function mapTestItemToDb(
    runId: string,
    ttl: number,
    { position, order, file, project, timeout }: TestItem,
    status: StatusOffset = StatusOffset.Pending,
): TestItemDb {
    const [line, character] = position.split(':');
    return {
        [Fields.Id]: runId,
        [Fields.Order]: (order % OFFSET_STEP) + status,
        [Fields.Line]: line,
        [Fields.Character]: character,
        [Fields.File]: file,
        [Fields.Project]: project,
        [Fields.Timeout]: timeout,
        [Fields.Ttl]: ttl,
    };
}

export function mapTestInfoItemToReport(
    item: TestInfoItem | undefined,
    { testResult }: DynamoResultTestParams,
): TestReport | undefined {
    if (!item || !testResult) return;
    return {
        [Fields.Duration]: item[Fields.EMA],
        [Fields.EMA]: item[Fields.EMA],
        [Fields.Title]: testResult.title,
        [Fields.Fails]: item[Fields.History].filter((h) => h[Fields.Status] === TestStatus.Failed).length,
        [Fields.LastSuccess]:
            item[Fields.History].findLast((h) => h[Fields.Status] === TestStatus.Passed)?.[Fields.Updated] ?? 0,
    };
}

export function mapDbToTestItem({
    [Fields.Order]: order,
    [Fields.Line]: line,
    [Fields.Character]: character,
    [Fields.File]: file,
    [Fields.Project]: project,
    [Fields.Timeout]: timeout,
}: TestItemDb): TestItem {
    return {
        position: `${line}:${character}`,
        file,
        project,
        order,
        timeout,
    };
}

export function parseStatus(status: TestReportResult['status']): TestStatus {
    if (status === 'passed') return TestStatus.Passed;
    return TestStatus.Failed;
}

export function idToStatus(id: number): TestStatus {
    if (id < StatusOffset.Running) return TestStatus.Ready;
    if (id < StatusOffset.Succeed) return TestStatus.Ongoing;
    if (id < StatusOffset.Failed) return TestStatus.Passed;
    return TestStatus.Failed;
}

export function mapDbTestInfoToSortItem(item: TestInfoItem): TestSortItem {
    return {
        ema: item[Fields.EMA],
        fails: item[Fields.History].filter((h) => h[Fields.Status] === TestStatus.Failed).length,
    };
}
