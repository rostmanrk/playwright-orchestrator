import { FullConfig, Reporter, Suite } from '@playwright/test/reporter';
import { RunBuilder } from './run-builder.js';

export default class RunInfoReporter implements Reporter {
    onBegin(config: FullConfig, suite: Suite) {
        const testRunInfo = new RunBuilder().parseConfig(config).parseEntry(suite).build();
        console.log(JSON.stringify(testRunInfo, null, 2));
    }
}
