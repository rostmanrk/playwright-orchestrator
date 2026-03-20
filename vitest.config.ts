import { defineConfig } from 'vitest/config';

// Vite does not understand the .cts extension (CommonJS TypeScript).
// This plugin strips TypeScript syntax from .cts files so they can be
// imported in tests that transitively pull in annotations.cts.
const ctsPlugin = {
    name: 'cts-transform',
    async transform(code: string, id: string) {
        if (!id.endsWith('.cts')) return;
        // esbuild is a transitive dep of vite — always available at runtime.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { transform } = (await import('esbuild')) as any;
        const result = await transform(code, { loader: 'ts', format: 'cjs' });
        return { code: result.code, map: result.map };
    },
};

export default defineConfig({
    plugins: [ctsPlugin],
    test: {
        include: ['tests/**/*.test.ts'],
    },
});
