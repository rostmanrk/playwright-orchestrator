import { TestRunReport } from '../types/reporter.js';
import { ghaReporter } from './gha-reporter.js';

export const REPORTERS = ['json', 'gha'] as const;
export type ReporterType = (typeof REPORTERS)[number];

export async function generateReport(data: TestRunReport, type: ReporterType): Promise<void> {
    switch (type) {
        case 'json':
            console.log(JSON.stringify(data));
            break;
        case 'gha':
            ghaReporter(data);
            break;
        default:
            console.error('Unknown reporter type');
    }
}
