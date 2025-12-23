import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import monacoEditorPlugin from 'vite-plugin-monaco-editor';
import tailwindcss from '@tailwindcss/vite';
import vitePluginCompression from 'vite-plugin-compression';
import AutoImport from 'unplugin-auto-import/vite';
import Components from 'unplugin-vue-components/vite';
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    // @ts-ignore because the plugin type might not perfectly match Vite's expected PluginOption type
    (monacoEditorPlugin as any).default({}),
    AutoImport({
      resolvers: [ElementPlusResolver()],
      imports: ['vue', 'vue-router', 'pinia'], // 自动导入 Vue 相关函数
      dts: 'src/auto-imports.d.ts',
    }),
    Components({
      dirs: ['src/components', 'src/features'],
      resolvers: [ElementPlusResolver({ importStyle: 'css' })], // 按需加载 Element Plus 组件和 CSS
      dts: 'src/components.d.ts',
    }),
    vitePluginCompression({
      verbose: true,
      disable: false,
      threshold: 10240, // 超过 10kb 进行压缩
      algorithm: 'gzip',
      ext: '.gz',
    }),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'monaco-editor': ['monaco-editor'],
          xterm: [
            'xterm',
            '@xterm/addon-fit',
            '@xterm/addon-search',
            '@xterm/addon-webgl',
            'xterm-addon-web-links',
          ],
          guacamole: ['guacamole-common-js'],
          chart: ['chart.js', 'vue-chartjs'],
          'vendor-core': ['vue', 'vue-router', 'pinia', 'axios', 'date-fns'],
        },
      },
    },
  },
  server: {
    proxy: {
      // 将所有 /api 开头的请求代理到后端服务器
      '/api': {
        target: 'http://localhost:3001', // 后端服务器地址
        changeOrigin: true, // 需要虚拟主机站点
        // 可选：如果后端 API 路径没有 /api 前缀，可以在这里重写路径
        // rewrite: (path) => path.replace(/^\/api/, '')
      },
      // 将所有 /uploads 开头的请求也代理到后端服务器
      '/uploads': {
        target: 'http://localhost:3001', // 后端服务器地址
        changeOrigin: true, // 对于静态资源通常也建议开启
        // 通常不需要重写静态资源的路径
      },
      '/ws': {
        target: 'ws://localhost:3001', // 后端 WebSocket 服务器地址
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
