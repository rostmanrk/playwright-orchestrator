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
        if (!res) return undefined;
        const test: TestItem = JSON.parse(res);
        await this.decrementCounters(test.ema);
        return test;
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
        if (!res) return undefined;
        const test: TestItem = JSON.parse(res);
        await this.decrementCounters(test.ema);
        return test;
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

        if (status === RunStatus.Finished) {
            const queueKey = `${this._namePrefix}:${TESTS}:${runId}`;
            // Atomic CAS: only the shard that wins the Finished→RepeatRun transition
            // moves the failed list and resets the counter keys. No cjson re-encode of
            // the config JSON — counters are stored as plain string keys to avoid the
            // cjson empty-array→object corruption bug.
            const script = `
local current = redis.call('GET', KEYS[1])
if current ~= ARGV[1] then return 0 end
local items = redis.call('LRANGE', KEYS[2], 0, -1)
redis.call('DEL', KEYS[2])
for i = 1, #items do redis.call('RPUSH', KEYS[3], items[i]) end
local totalEma = 0
for i = 1, #items do
    local item = cjson.decode(items[i])
    totalEma = totalEma + (item.ema or 0)
end
local ttl = tonumber(ARGV[4])
redis.call('SET', KEYS[4], tostring(#items), 'EX', ttl)
redis.call('SET', KEYS[5], tostring(totalEma), 'EX', ttl)
redis.call('SET', KEYS[1], ARGV[2], 'EX', ttl)
redis.call('SET', KEYS[6], ARGV[3], 'EX', ttl)
return 1`;
            await client.eval(script, {
                keys: [
                    statusKey,
                    `${queueKey}:failed`,
                    `${queueKey}:queue`,
                    `${key}:remainingCount`,
                    `${key}:remainingTime`,
                    updatedKey,
                ],
                arguments: [
                    String(RunStatus.Finished),
                    String(RunStatus.RepeatRun),
                    String(new Date().getTime()),
                    String(this.ttl),
                ],
            });
        } else if (status === RunStatus.Created) {
            await client
                .multi()
                .set(statusKey, RunStatus.Run, { EX: this.ttl })
                .set(updatedKey, new Date().getTime(), { EX: this.ttl })
                .exec();
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

    async getRemainingCounters(_config: TestRunConfig): Promise<{ remainingCount: number; remainingTime: number }> {
        const { runId } = this.runContext;
        const client = await this.connection.getClient();
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const [count, time] = (await client
            .multi()
            .get(`${key}:remainingCount`)
            .get(`${key}:remainingTime`)
            .exec()) as [string | null, string | null];
        return {
            remainingCount: Math.max(0, Number(count ?? 0)),
            remainingTime: Math.max(0, Number(time ?? 0)),
        };
    }

    private async decrementCounters(ema: number): Promise<void> {
        const { runId } = this.runContext;
        const client = await this.connection.getClient();
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        await client.multi().incrBy(`${key}:remainingCount`, -1).incrByFloat(`${key}:remainingTime`, -ema).exec();
    }
}
