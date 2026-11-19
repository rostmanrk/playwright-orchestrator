import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { PgPool } from '../packages/pg/src/pg-pool.js';
import type { CreateArgs } from '../packages/pg/src/create-args.js';

afterEach(() => {
    vi.restoreAllMocks();
});

function makePool() {
    const args: CreateArgs = { connectionString: 'postgres://localhost:5432/test', tableNamePrefix: 'test' };
    return new PgPool(args).pool;
}

// An 'error' event with no listener is thrown, which exits the process when it comes from a socket
describe('PgPool', () => {
    it('logs errors from idle connections instead of crashing the process', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const pool = makePool();

        expect(() => pool.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith('Postgres connection error: Connection terminated unexpectedly');
    });

    it('handles errors from connections in use', () => {
        const pool = makePool();
        const client = new EventEmitter();
        pool.emit('connect', client);

        expect(() => client.emit('error', new Error('Connection terminated unexpectedly'))).not.toThrow();
    });
});
