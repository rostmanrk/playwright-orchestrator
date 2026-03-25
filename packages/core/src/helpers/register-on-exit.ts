const callbacks: (() => void)[] = [];
let handled = false;

function signalHandler(isError = true) {
    return function () {
        if (handled) return;
        for (const callback of callbacks) {
            try {
                callback();
            } catch (err) {
                // Ignore errors during exit handling.
            }
        }
        if (isError) {
            process.exit(1);
        }
        handled = true;
    };
}

for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'] as const) {
    process.on(signal, signalHandler());
}

for (const signal of ['exit'] as const) {
    process.on(signal, signalHandler(false));
}

export function registerOnExit(callback: () => void) {
    callbacks.push(callback);
}
