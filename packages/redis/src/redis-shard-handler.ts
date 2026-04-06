import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRunConfig, TestRunContext } from '@playwright-orchestrator/core';
import { RunStatus, SYMBOLS } from '@playwright-orchestrator/core';
import type { TestItem } from '@playwright-orchestrator/core';
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
        @inject(SYMBOLS.RunContext) private readonly runContext: TestRunContext,
    ) {
        this._namePrefix = namePrefix;
        this.connection = connection;
        this.ttl = ttl * 24 * 60 * 60;
    }
    async getNextTestByProject(project: string): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        const client = await this.connection.getClient();
        const res = await client.lPop(`${this._namePrefix}:${TESTS}:${runId}:queue:${project}`);
        return res ? JSON.parse(res) : undefined;
    }

    async getNextTest(config: TestRunConfig): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        const script = `
local item = redis.call('LPOP', KEYS[1])
if item then
    return item
end

local bestKey = nil
local bestLen = 0

for i = 1, #ARGV do
    local len = redis.call('LLEN', ARGV[i])
    if len > bestLen then
        bestLen = len
        bestKey = ARGV[i]
    end
end

if bestKey then
    return redis.call('LPOP', bestKey)
end

return nil`;
        const client = await this.connection.getClient();
        const primaryKey = `${this._namePrefix}:${TESTS}:${runId}:queue`;
        const res = (await client.eval(script, {
            keys: [primaryKey],
            arguments: config.projects.map((project) => `${primaryKey}:${project.name}`),
        })) as string | null;
        return res ? JSON.parse(res) : undefined;
    }

    async startShard(): Promise<TestRunConfig> {
        const { runId, shardId } = this.runContext;
        const client = await this.connection.getClient();
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const statusKey = `${key}:status`;
        const updatedKey = `${key}:updated`;
        const shardsKey = `${key}:shards`;
        const [dbStatus, existingShard] = (await client.multi().get(statusKey).hGet(shardsKey, shardId).exec()) as [
            string | null,
            string | null,
        ];
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
        if (!existingShard) {
            await client
                .multi()
                .hSet(shardsKey, { [shardId]: JSON.stringify({ shardId, started: new Date().getTime() }) })
                .expire(shardsKey, this.ttl)
                .exec();
        }
        return this.loadConfig();
    }

    async finishShard(): Promise<void> {
        const { runId, shardId } = this.runContext;
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const client = await this.connection.getClient();
        const dbShards = await client.hGet(`${key}:shards`, shardId);
        const multi = client
            .multi()
            .set(`${key}:status`, RunStatus.Finished, { EX: this.ttl })
            .set(`${key}:updated`, new Date().getTime(), { EX: this.ttl });
        if (dbShards) {
            const shardData = JSON.parse(dbShards);
            shardData.finished ??= new Date().getTime();
            multi.hSet(`${key}:shards`, { [shardId]: JSON.stringify(shardData) }).expire(`${key}:shards`, this.ttl);
        }
        await multi.exec();
    }

    private async loadConfig(): Promise<TestRunConfig> {
        const { runId } = this.runContext;
        const client = await this.connection.getClient();
        const config = await client.get(`${this._namePrefix}:${TEST_RUN}:${runId}:config`);
        if (!config) throw new Error(`Run ${runId} not found`);
        return JSON.parse(config);
    }
}
