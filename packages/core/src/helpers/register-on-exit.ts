import { constants } from 'node:os';

type InterruptHandler = (signal: NodeJS.Signals) => void;

const callbacks: (() => void)[] = [];
const interruptHandlers = new Set<InterruptHandler>();
let handled = false;
let interrupted = false;

function runCallbacks() {
    if (handled) return;
    handled = true;
    for (const callback of callbacks) {
        try {
            callback();
        } catch {
            // Ignore errors during exit handling.
        }
    }
}

function onSignal(signal: NodeJS.Signals) {
    const exitCode = 128 + constants.signals[signal];
    // The first signal lets interrupt handlers stop gracefully; a second one, or one with no handlers, exits at once
    if (!interrupted && interruptHandlers.size > 0) {
        interrupted = true;
        process.exitCode = exitCode;
        for (const handler of interruptHandlers) {
            try {
                handler(signal);
            } catch {
                // Ignore errors during interrupt handling.
            }
        }
        return;
    }
    runCallbacks();
    process.exit(exitCode);
}

for (const signal of ['SIGINT', 'SIGHUP', 'SIGTERM'] as const) {
    process.on(signal, onSignal);
}

process.on('exit', runCallbacks);

export function registerOnExit(callback: () => void) {
    callbacks.push(callback);
}

/** Handles the first termination signal instead of exiting. Returns a function that removes the handler. */
export function registerOnInterrupt(handler: InterruptHandler): () => void {
    interruptHandlers.add(handler);
    return () => interruptHandlers.delete(handler);
}
