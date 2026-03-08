import { injectable, inject, preDestroy } from 'inversify';
import type { CreateArgs } from './create-args.js';
import { createClient, RedisClientType } from 'redis';
import { REDIS_CONFIG } from './symbols.js';

@injectable()
export class RedisConnection {
    private readonly client: RedisClientType;
    private connectPromise: Promise<unknown> | null = null;

    constructor(@inject(REDIS_CONFIG) { connectionString }: CreateArgs) {
        this.client = createClient({ url: connectionString });
    }

    async getClient(): Promise<RedisClientType> {
        if (!this.client.isOpen) {
            if (!this.connectPromise) {
                this.connectPromise = this.client.connect().finally(() => {
                    this.connectPromise = null;
                });
            }
            await this.connectPromise;
        }
        return this.client;
    }

    @preDestroy()
    async dispose(): Promise<void> {
        if (this.client.isOpen) {
            await this.client.quit();
        }
    }
}
