import { tmpdir } from 'os';
import { writeFile } from 'node:fs/promises';
import * as uuid from 'uuid';
import { program } from './program.js';
import { Container } from 'inversify';

export function handle<TArgs extends any[], TResult>(
    target: (container: Container, ...args: TArgs) => Promise<TResult> | TResult,
): (...args: TArgs) => Promise<TResult | undefined> {
    return async (...args: TArgs): Promise<TResult | undefined> => {
        const container = new Container();
        try {
            return await target(container, ...args);
        } catch (error: unknown) {
            const logFile = `${tmpdir()}/${uuid.v7()}.log`;
            const errorDetails = {
                message: error instanceof Error ? error.message : 'Unknown error',
                stack: error instanceof Error ? error.stack : undefined,
                timestamp: new Date().toISOString(),
                details: error,
            };

            try {
                await writeFile(logFile, JSON.stringify(errorDetails, null, 2));
                program.error(`Error occurred. Log file: ${logFile}\nError: ${errorDetails.message}`);
            } catch (writeError) {
                program.error(`Failed to write error log. Original error: ${errorDetails.message}`);
            }
            return undefined;
        } finally {
            await container.unbindAllAsync();
        }
    };
}
