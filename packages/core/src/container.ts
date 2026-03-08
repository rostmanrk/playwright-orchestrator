import 'reflect-metadata';
import { Container } from 'inversify';
import { PlaywrightRunInfoLoader } from './adapters/playwright-run-info-loader.js';

export const SYMBOLS = {
    Adapter: Symbol.for('Adapter'),
    Initializer: Symbol.for('Initializer'),
    RunInfoLoader: Symbol.for('RunInfoLoader'),
    RunId: Symbol.for('RunId'),
    OutputFolder: Symbol.for('OutputFolder'),
    ShardHandler: Symbol.for('ShardHandler'),
    TestRunCreator: Symbol.for('TestRunCreator'),
    TestRunner: Symbol.for('TestRunner'),
};

export function createContainer(): Container {
    const container = new Container();
    container.bind(SYMBOLS.RunInfoLoader).to(PlaywrightRunInfoLoader).inSingletonScope();
    return container;
}
