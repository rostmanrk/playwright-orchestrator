import { tmpdir } from 'os';
import { writeFile } from 'fs/promises';
import * as uuid from 'uuid';
import { program } from './program';

export function withErrorHandling<T extends (...args: any[]) => Promise<any> | any>(
    target: T,
): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>>> {
    return async (...args) => {
        try {
            return await target(...args);
        } catch (error: unknown) {
            const logFile = `${tmpdir()}/${uuid.v4()}.log`;
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
            return undefined as Awaited<ReturnType<T>>;
        }
    };
}
