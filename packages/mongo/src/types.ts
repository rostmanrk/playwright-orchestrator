import { RunStatus, TestItem, TestRunConfig, TestStatus } from '@playwright-orchestrator/core';
import { Binary, Document } from 'mongodb';

export interface TestRunDocument extends Document {
    _id: Binary;
    status: RunStatus;
    config: TestRunConfig;
    updated: Date;
}

export interface TestDocument extends Document, Omit<TestItem, 'order' | 'position'> {
    _id: Binary;
    runId?: string;
    order?: number;
    line: number;
    column: number;
    status: TestStatus;
    updated: Date;
    report?: TestItemReport;
}

export interface TestItemReport {
    duration: number;
    title: string;
    fails: number;
    ema: number;
    lastSuccessfulRun?: Date;
}

export interface TestInfoDocument extends Document {
    _id: string;
    create: Date;
    ema: number;
    history: {
        duration: number;
        status: TestStatus;
        updated: Date;
    }[];
}
