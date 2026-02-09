import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        include: ['src/tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'html'],
            include: ['src/modules/**/*.ts'],
            exclude: ['src/modules/**/*.types.ts', 'src/modules/**/*.schema.ts']
        },
        testTimeout: 10000,
    },
});
