import { Command } from '@commander-js/extra-typings';
import init from './init.js';
import run from './run.js';
import create from './create.js';
import createReport from './create-report.js';
import { cliVersion } from './version.js';

export const program = new Command();

program.name('playwright-orchestrator').description('CLI to orchestrate Playwright tests').version(cliVersion);

await init();
await run();
await create();
await createReport();

program.parse();
