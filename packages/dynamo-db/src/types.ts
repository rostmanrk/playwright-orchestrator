import { ResultTestParams, TestRunConfig, TestShard, TestItem } from '@playwright-orchestrator/core';
import { Fields } from './constants.js';

export interface TestItemDb {
    [Fields.Id]: string;
    [Fields.Order]: number;
    [Fields.TestId]: string;
    [Fields.Timeout]: number;
    [Fields.EMA]: number;
    [Fields.Ttl]: number;
    [Fields.Report]?: TestReport;
    [Fields.Meta]: TestItem['meta'];
}

export interface TestReport {
    [Fields.Duration]: number;
    [Fields.EMA]: number;
    [Fields.Fails]: number;
    [Fields.LastSuccess]: number;
}

export interface TestRunDb {
    [Fields.Id]: string;
    [Fields.Order]: number;
    [Fields.Updated]: number;
    [Fields.Status]: number;
    [Fields.Config]: TestRunConfig;
    [Fields.Shards]: Record<string, TestShard>;
    [Fields.Ttl]: number;
}

export interface TestInfoItem {
    [Fields.Id]: string;
    [Fields.Order]: number;
    [Fields.Created]: number;
    [Fields.EMA]: number;
    [Fields.History]: {
        [Fields.Duration]: number;
        [Fields.Updated]: number;
        [Fields.Status]: number;
    }[];
    [Fields.Ttl]: number;
    [Fields.Version]: number;
}

export type DynamoResultTestParams = Omit<ResultTestParams, 'testResult'> &
    Partial<Pick<ResultTestParams, 'testResult'>>;
