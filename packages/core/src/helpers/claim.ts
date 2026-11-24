import type { TestItem, TestRun, TestRunConfig } from '../types/adapters.js';

/** Time on top of a batch's budget for starting Playwright, hooks and saving the results */
export const CLAIM_MARGIN = 1 * 60 * 1000;

/**
 * Deadline a test gets when it is claimed, until its batch is ready and `getBatchDeadline` replaces it.
 * Assembling a batch takes far less than the margin, and a shard that dies meanwhile still leaves a deadline.
 */
export function getClaimDeadline(now = Date.now()): number {
    return now + CLAIM_MARGIN;
}

/**
 * Longest time a test can run: every attempt, repeat and project. Infinity when it has no timeout.
 * A serial group's timeout is already the sum of its children's.
 */
export function getTestBudget(test: TestItem, config: TestRunConfig): number {
    if (!test.timeout) return Infinity;
    let budget = 0;
    for (const name of test.meta.projects) {
        const project = config.projects.find((project) => project.name === name);
        budget += test.timeout * (project?.repeatEach ?? 1) * ((project?.retries ?? 0) + 1);
    }
    return budget;
}

/**
 * When a batch must have finished if its shard is alive. A batch runs its tests one after another,
 * so it takes at most the sum of their budgets. Null when one of them has no timeout or the start is unknown:
 * such a batch's tests are only queued again once every other shard has finished.
 */
export function getBatchDeadline(batch: TestItem[], config: TestRunConfig, start: number): number | null {
    const deadline = start + batch.reduce((sum, test) => sum + getTestBudget(test, config), 0) + CLAIM_MARGIN;
    return Number.isFinite(deadline) ? deadline : null;
}

/**
 * Whether every shard other than the current one has finished. Then no shard is running the tests
 * that are still claimed, so a repeat run can queue them all again, whatever their deadline.
 */
export function everyOtherShardFinished(shards: TestRun['shards'] | undefined, currentShardId: string): boolean {
    return Object.entries(shards ?? {}).every(
        ([shardId, shard]) => shardId === currentShardId || shard.finished != null,
    );
}
