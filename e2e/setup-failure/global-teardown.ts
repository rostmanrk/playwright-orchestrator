import { writeFileSync } from 'node:fs';

// Records that teardown ran even though global setup failed
export default function globalTeardown() {
    writeFileSync(process.env.TEARDOWN_MARKER!, 'ran');
}
