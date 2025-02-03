import { ResultTestParams } from '@playwright-orchestrator/core';
import { Fields } from './constants.js';

export interface TestItemDb {
    [Fields.Id]: string;
    [Fields.Order]: number;
    [Fields.Line]: string;
    [Fields.Character]: string;
    [Fields.File]: string;
    [Fields.Project]: string;
    [Fields.Timeout]: number;
    [Fields.Ttl]: number;
    [Fields.Report]?: TestReport;
}

export interface TestReport {
    [Fields.Duration]: number;
    [Fields.EMA]: number;
    [Fields.Fails]: number;
    [Fields.LastSuccess]: number;
    [Fields.Title]: string;
}

export interface TestRunConfig {
    [Fields.Id]: string;
    [Fields.Order]: number;
    [Fields.Config]: TestRunConfig;
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
