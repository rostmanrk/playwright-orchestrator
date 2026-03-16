export async function withRetry<T>(fn: () => Promise<T>, retries: number, delay: number = 50): Promise<T> {
    const maxRetries = Math.max(0, Math.floor(retries));
    const baseDelay = Math.max(0, delay);

    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            return await fn();
        } catch (error) {
            if (attempt >= maxRetries) {
                throw error;
            }

            const jitterFactor = 0.5 + Math.random();
            const waitTime = baseDelay * jitterFactor;

            if (waitTime > 0) {
                await new Promise((resolve) => setTimeout(resolve, waitTime));
            }

            attempt += 1;
        }
    }

    throw new Error('Unreachable code in withRetry');
}
