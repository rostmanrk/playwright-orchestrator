import { HistoryItem, TestItem, TestStatus } from '@playwright-orchestrator/core';

export interface ResultTestItem extends TestItem {
    status: TestStatus;
    report: {
        duration: number;
        ema: number;
        fails: number;
        title: string;
        lastSuccessfulRunTimestamp?: number;
    };
}

/** Claimed tests without a result, by test id. The claiming shard is in `meta.shardId`. */
export type ClaimedTests = Record<string, TestItem>;

export interface TestHistoryItem {
    ema: number;
    created: number;
    history: HistoryItem[];
}
