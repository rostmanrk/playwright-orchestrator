import { TestItem, TestReportResult, TestRun, TestSortItem, TestStatus } from '@playwright-orchestrator/core';
import { Fields, OFFSET_STEP, StatusOffset } from './constants.js';
import { TestInfoItem, TestItemDb, TestRunDb } from './types.js';

export function mapTestItemToDb(
    runId: string,
    ttl: number,
    { position, order, file, projects, timeout, children, testId }: TestItem,
    status: StatusOffset = StatusOffset.Pending,
): TestItemDb {
    const [line, character] = position.split(':');
    return {
        [Fields.Id]: runId,
        [Fields.Order]: (order % OFFSET_STEP) + status,
        [Fields.TestId]: testId,
        [Fields.Line]: line,
        [Fields.Character]: character,
        [Fields.File]: file,
        [Fields.Projects]: projects,
        [Fields.Timeout]: timeout,
        [Fields.Ttl]: ttl,
        [Fields.Children]: children,
    };
}

export function mapDbToTestItem({
    [Fields.TestId]: testId,
    [Fields.Order]: order,
    [Fields.Line]: line,
    [Fields.Character]: character,
    [Fields.File]: file,
    [Fields.Project]: project,
    [Fields.Projects]: projects,
    [Fields.Timeout]: timeout,
    [Fields.Children]: children,
}: TestItemDb): TestItem {
    return {
        testId,
        position: `${line}:${character}`,
        file,
        projects: projects ?? [project!],
        order,
        timeout,
        children,
    };
}

export function mapTestRunToDb(runId: string, ttl: number, { config, status, updated }: TestRun): TestRunDb {
    return {
        [Fields.Id]: runId,
        [Fields.Order]: 0,
        [Fields.Config]: config,
        [Fields.Updated]: updated,
        [Fields.Status]: status,
        [Fields.Ttl]: ttl,
    };
}

export function mapDbToTestRun({
    [Fields.Config]: config,
    [Fields.Updated]: updated,
    [Fields.Status]: status,
}: TestRunDb): TestRun {
    return {
        config,
        updated,
        status: status as TestStatus,
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

export function getTtl(ttl: number): number {
    return Math.floor(Date.now() / 1000) + ttl;
}
