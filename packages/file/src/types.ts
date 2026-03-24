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

export interface TestHistoryItem {
    ema: number;
    created: number;
    history: HistoryItem[];
}
