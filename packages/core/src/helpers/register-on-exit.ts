const callbacks: (() => void)[] = [];

function signalHandler() {
    for (const callback of callbacks) {
        try {
            callback();
        } catch (err) {
            // Ignore errors during exit handling.
        }
    }
    process.exit(1);
}

for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM', 'exit'] as const) {
    process.on(signal, signalHandler);
}

export function registerOnExit(callback: () => void) {
    callbacks.push(callback);
}
