import { Command } from '@commander-js/extra-typings';
import init from './init.js';
import run from './run.js';
import create from './create.js';
import { readFile } from 'node:fs/promises';

export const program = new Command();

const package_json = JSON.parse(await readFile('package.json', 'utf-8'));

program
    .name('playwright-orchestrator')
    .description('CLI to orchestrate Playwright tests')
    .version(package_json.version);

await init();
await run();
await create();

program.parse();
