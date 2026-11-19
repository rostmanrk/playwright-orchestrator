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
        // Without a listener Node treats socket errors as uncaught and exits. node-redis reconnects on its own
        // and queues commands meanwhile, so a dropped connection only needs logging.
        this.client.on('error', (error: Error) => {
            console.error(`Redis connection error: ${error.message}`);
        });
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
