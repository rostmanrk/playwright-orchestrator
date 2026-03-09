export const getRunIdFilePath = (dir: string, runId: string) => `${dir}/${runId}.queue.json`;
export const getRunConfigPath  = (dir: string, runId: string) => `${dir}/${runId}.config.json`;
export const getHistoryRunPath = (dir: string)                => `${dir}/tests.history.json`;
export const getResultsRunPath = (dir: string, runId: string) => `${dir}/${runId}.results.json`;
