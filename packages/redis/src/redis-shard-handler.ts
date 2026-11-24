import { injectable, inject } from 'inversify';
import type { ShardHandler, TestRunConfig, TestRunContext, TestShard } from '@playwright-orchestrator/core';
import { everyOtherShardFinished, getClaimDeadline, RunStatus, SYMBOLS } from '@playwright-orchestrator/core';
import type { TestItem } from '@playwright-orchestrator/core';
import type { CreateArgs } from './create-args.js';
import { RedisConnection } from './redis-connection.js';
import { REDIS_CONFIG, REDIS_CONNECTION } from './symbols.js';

const TESTS = 'T';
const TEST_RUN = 'TR';

/**
 * Records a popped test in the run's hash of claimed tests (KEYS[1]) until its result is saved,
 * so a repeat run can queue it again if its shard dies, with its claim deadline in KEYS[2].
 * ARGV[1] is the TTL, ARGV[2] the deadline.
 * The item is kept as the raw string: decoding and encoding it with cjson would corrupt empty arrays.
 */
const RECORD_CLAIM = `
local function recordClaim(item)
    local testId = cjson.decode(item).testId
    redis.call('HSET', KEYS[1], testId, item)
    redis.call('HSET', KEYS[2], testId, ARGV[2])
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    redis.call('EXPIRE', KEYS[2], ARGV[1])
    return item
end`;

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
        const script = `${RECORD_CLAIM}
local item = redis.call('LPOP', KEYS[3])
if item then
    return recordClaim(item)
end
return nil`;
        const res = (await client.eval(script, {
            keys: [
                this.claimedKey(runId),
                this.deadlinesKey(runId),
                `${this._namePrefix}:${TESTS}:${runId}:queue:${project}`,
            ],
            arguments: [String(this.ttl), String(getClaimDeadline())],
        })) as string | null;
        if (!res) return undefined;
        const test: TestItem = JSON.parse(res);
        await this.decrementCounters(test.ema);
        return test;
    }

    async getNextTest(config: TestRunConfig): Promise<TestItem | undefined> {
        const { runId } = this.runContext;
        const script = `${RECORD_CLAIM}
local item = redis.call('LPOP', KEYS[3])
if item then
    return recordClaim(item)
end

local bestKey = nil
local bestLen = 0

for i = 4, #KEYS do
    local len = redis.call('LLEN', KEYS[i])
    if len > bestLen then
        bestLen = len
        bestKey = KEYS[i]
    end
end

if bestKey then
    return recordClaim(redis.call('LPOP', bestKey))
end

return nil`;
        const client = await this.connection.getClient();
        const primaryKey = `${this._namePrefix}:${TESTS}:${runId}:queue`;
        const res = (await client.eval(script, {
            // Every key the script touches goes in KEYS, so Redis ACLs and proxies see them
            keys: [
                this.claimedKey(runId),
                this.deadlinesKey(runId),
                primaryKey,
                ...config.projects.map((project) => `${primaryKey}:${project.name}`),
            ],
            arguments: [String(this.ttl), String(getClaimDeadline())],
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
            const won = await client.eval(script, {
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
            if (won === 1) {
                await this.requeueAbandonedTests(runId);
            }
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

    /** Queues again the claimed tests without a result whose shard is done or must have died */
    private async requeueAbandonedTests(runId: string): Promise<void> {
        const client = await this.connection.getClient();
        const key = `${this._namePrefix}:${TEST_RUN}:${runId}`;
        const shards = Object.fromEntries(
            Object.entries(await client.hGetAll(`${key}:shards`)).map(([shardId, shard]) => [
                shardId,
                JSON.parse(shard) as TestShard,
            ]),
        );
        const script = `
local claimed = redis.call('HGETALL', KEYS[1])
for i = 1, #claimed, 2 do
    local testId = claimed[i]
    local deadline = tonumber(redis.call('HGET', KEYS[2], testId))
    if ARGV[1] == '1' or (deadline and deadline < tonumber(ARGV[2])) then
        local item = claimed[i + 1]
        redis.call('RPUSH', KEYS[3], item)
        redis.call('HDEL', KEYS[1], testId)
        redis.call('HDEL', KEYS[2], testId)
        redis.call('INCRBY', KEYS[4], 1)
        redis.call('INCRBYFLOAT', KEYS[5], cjson.decode(item).ema or 0)
    end
end`;
        await client.eval(script, {
            keys: [
                this.claimedKey(runId),
                this.deadlinesKey(runId),
                `${this._namePrefix}:${TESTS}:${runId}:queue`,
                `${key}:remainingCount`,
                `${key}:remainingTime`,
            ],
            arguments: [everyOtherShardFinished(shards, this.runContext.shardId) ? '1' : '0', String(Date.now())],
        });
    }

    async setClaimDeadline(tests: TestItem[], deadline: number | null): Promise<void> {
        const { runId } = this.runContext;
        const client = await this.connection.getClient();
        // Only for tests still claimed, so a test with a result gets no deadline entry back
        const script = `
for i = 1, #ARGV - 1 do
    if redis.call('HEXISTS', KEYS[1], ARGV[i]) == 1 then
        if ARGV[#ARGV] == '' then
            redis.call('HDEL', KEYS[2], ARGV[i])
        else
            redis.call('HSET', KEYS[2], ARGV[i], ARGV[#ARGV])
        end
    end
end`;
        await client.eval(script, {
            keys: [this.claimedKey(runId), this.deadlinesKey(runId)],
            arguments: [...tests.map((test) => test.testId), deadline === null ? '' : String(deadline)],
        });
    }

    private deadlinesKey(runId: string): string {
        return `${this.claimedKey(runId)}:deadline`;
    }

    private claimedKey(runId: string): string {
        return `${this._namePrefix}:${TESTS}:${runId}:claimed`;
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
