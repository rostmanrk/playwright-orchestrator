import 'reflect-metadata';
import { Container } from 'inversify';
import { PlaywrightRunInfoLoader } from './adapters/playwright-run-info-loader.js';
import { BrowserManager } from './runner/browser-manager.js';
import { TestExecutionReporter } from './runner/test-execution-reporter.js';
import { SYMBOLS } from './symbols.js';

export function createContainer(): Container {
    const container = new Container();
    container.bind(SYMBOLS.RunInfoLoader).to(PlaywrightRunInfoLoader).inSingletonScope();
    container.bind(SYMBOLS.TestExecutionReporter).to(TestExecutionReporter).inSingletonScope();
    container.bind(SYMBOLS.BrowserManager).to(BrowserManager).inSingletonScope();
    return container;
}
