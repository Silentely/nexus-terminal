import { defineConfig } from 'vitest/config';
import vue from '@vitejs/plugin-vue';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'pinia'],
      dts: false,
    }),
    // 与 vite.config.ts 保持一致：自动注册 src/components 与 src/features 下的组件，
    // 避免测试环境无法解析 LoadingState/EmptyState 等公共组件导致静默渲染失败
    Components({
      dirs: ['src/components', 'src/features'],
      dts: false,
    }),
  ],
  server: {
    host: '127.0.0.1',
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        url: 'http://127.0.0.1/',
      },
    },
    root: path.resolve(__dirname),
    include: ['src/**/*.{test,spec}.ts', 'tests/**/*.{test,spec}.ts'],
    exclude: ['node_modules', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: ['src/**/*.{ts,vue}'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/locales/**',
        'src/assets/**',
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
      'monaco-editor': path.resolve(__dirname, 'tests/__mocks__/monaco-editor.ts'),
    },
  },
});
