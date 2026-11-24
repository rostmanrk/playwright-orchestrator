// Preloaded with `node --import` to move Date.now forward by CLOCK_OFFSET_MS,
// so a process sees claims made just before as long expired.
const offset = Number(process.env.CLOCK_OFFSET_MS ?? 0);
const now = Date.now;
Date.now = () => now() + offset;
