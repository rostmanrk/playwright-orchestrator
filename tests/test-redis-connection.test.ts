import { describe, it, expect, vi, afterEach } from 'vitest';
import type { EventEmitter } from 'node:events';
import { RedisConnection } from '../packages/redis/src/redis-connection.js';
import type { CreateArgs } from '../packages/redis/src/create-args.js';

afterEach(() => {
    vi.restoreAllMocks();
});

describe('RedisConnection', () => {
    it('logs client errors instead of crashing the process', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const args: CreateArgs = { connectionString: 'redis://localhost:6379', namePrefix: 'test', ttl: 60 };
        const connection = new RedisConnection(args);
        const client = (connection as unknown as { client: EventEmitter }).client;

        // An 'error' event with no listener is thrown, which exits the process when it comes from a socket
        expect(() => client.emit('error', new Error('Socket closed unexpectedly'))).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith('Redis connection error: Socket closed unexpectedly');
    });
});
