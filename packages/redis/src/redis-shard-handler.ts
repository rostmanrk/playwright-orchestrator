import { injectable, inject } from 'inversify';
import type { ShardHandler } from '@playwright-orchestrator/core';
import { RunStatus } from '@playwright-orchestrator/core';
import type { TestItem, TestRunConfig } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { RedisConnection } from './redis-connection.js';
import { REDIS_CONFIG, REDIS_CONNECTION } from './symbols.js';

const TESTS = 'T';
const TEST_RUN = 'TR';

@injectable()
export class RedisShardHandler implements ShardHandler {
    private readonly _namePrefix: string;
    private readonly connection: RedisConnection;
    private readonly ttl: number;

    constructor(
        @inject(REDIS_CONFIG) { namePrefix, ttl }: CreateArgs,
        @inject(REDIS_CONNECTION) connection: RedisConnection,
    ) {
        this._namePrefix = namePrefix;
        this.connection = connection;
        this.ttl = ttl * 24 * 60 * 60;
    }

    async getNextTest(runId: string, _config: TestRunConfig): Promise<TestItem | undefined> {
        const client = await this.connection.getClient();
        const res = await client.lPop(`${this._namePrefix}:${TESTS}:${runId}:queue`);
        return res ? JSON.parse(res) : undefined;
    }

    async startShard(runId: string): Promise<TestRunConfig> {
        const client = await this.connection.getClient();
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const statusKey = `${key}:status`;
        const updatedKey = `${key}:updated`;
        const dbStatus = await client.get(statusKey);
        if (!dbStatus) throw new Error(`Run ${runId} not found`);
        const status = +dbStatus as RunStatus;

        if (status === RunStatus.Created || status === RunStatus.Finished) {
            const transaction = client.multi();
            if (status === RunStatus.Finished) {
                const queueKey = `${this._namePrefix}:${TESTS}:${runId}`;
                const script = `
                    local items = redis.call('LRANGE', KEYS[1], 0, -1)
                    redis.call('DEL', KEYS[1])
                    return items
                    `;
                const res = ((await client.eval(script, { keys: [`${queueKey}:failed`] })) ?? []) as string[];
                const elements = res.map((el: string) => JSON.parse(el));
                elements.sort((a, b) => a.order - b.order);
                for (const el of elements) {
                    transaction.rPush(`${queueKey}:queue`, JSON.stringify(el));
                }
            }
            transaction.set(statusKey, status === RunStatus.Created ? RunStatus.Run : RunStatus.RepeatRun, {
                EX: this.ttl,
            });
            transaction.set(updatedKey, new Date().getTime(), { EX: this.ttl });
            await transaction.exec();
        }
        return this.loadTestRunConfig(runId);
    }

    async finishShard(runId: string): Promise<void> {
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const client = await this.connection.getClient();
        await client
            .multi()
            .set(`${key}:status`, RunStatus.Finished, { EX: this.ttl })
            .set(`${key}:updated`, new Date().getTime(), { EX: this.ttl })
            .exec();
    }

    private async loadTestRunConfig(runId: string): Promise<TestRunConfig> {
        const client = await this.connection.getClient();
        const baseKey = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const [config, status, updated] = await client.mGet([
            `${baseKey}:config`,
            `${baseKey}:status`,
            `${baseKey}:updated`,
        ]);
        if (!config || !status || !updated) throw new Error(`Run ${runId} not found`);
        return { ...JSON.parse(config), status: +status, updated: +updated };
    }
}
