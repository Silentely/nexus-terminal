import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        globals: true,
        environment: 'node',
        root: path.resolve(__dirname),
        include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
        exclude: ['node_modules', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'html', 'lcov'],
            reportsDirectory: './coverage',
            include: ['src/**/*.ts'],
            exclude: [
                'src/**/*.d.ts',
                'src/**/*.test.ts',
                'src/**/*.spec.ts',
                'src/index.ts',
                'src/locales/**',
            ],
            thresholds: {
                global: {
                    branches: 90,
                    functions: 90,
                    lines: 90,
                    statements: 90,
                },
            },
        },
        testTimeout: 10000,
        hookTimeout: 10000,
        setupFiles: ['./tests/setup.ts'],
        alias: {
            '@': path.resolve(__dirname, 'src'),
        },
    },
});
