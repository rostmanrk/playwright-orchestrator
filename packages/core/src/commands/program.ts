import { Command } from '@commander-js/extra-typings';
import * as package_json from '../../package.json';

export const program = new Command();

program
    .name('playwright-orchestrator')
    .description('CLI to orchestrate Playwright tests')
    .version(package_json.version);

import './run';
import './create';
import './init';

program.parse();
