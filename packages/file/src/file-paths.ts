export const getRunIdFilePath = (dir: string, runId: string) => `${dir}/${runId}.queue.json`;
export const getRunConfigPath = (dir: string, runId: string) => `${dir}/${runId}.config.json`;
export const getHistoryRunPath = (dir: string) => `${dir}/tests.history.json`;
/** Tests claimed by a shard that have no result yet. Guarded by the queue file's lock. */
export const getClaimedRunPath = (dir: string, runId: string) => `${dir}/${runId}.claimed.json`;
export const getResultsRunPath = (dir: string, runId: string) => `${dir}/${runId}.results.json`;
