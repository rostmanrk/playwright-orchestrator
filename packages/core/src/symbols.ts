export const SYMBOLS = {
    Adapter: Symbol.for('Adapter'),
    Initializer: Symbol.for('Initializer'),
    RunInfoLoader: Symbol.for('RunInfoLoader'),
    RunId: Symbol.for('RunId'),
    OutputFolder: Symbol.for('OutputFolder'),
    ShardHandler: Symbol.for('ShardHandler'),
    TestRunCreator: Symbol.for('TestRunCreator'),
    TestRunner: Symbol.for('TestRunner'),
    BrowserManager: Symbol.for('BrowserManager'),
    BatchHandler: Symbol.for('BatchHandler'),
    TestExecutionReporter: Symbol.for('TestExecutionReporter'),
} as const;
