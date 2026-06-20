<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, computed } from 'vue';
import { Terminal } from '@xterm/xterm';
import { useAppearanceStore } from '../../stores/appearance.store';
import { storeToRefs } from 'pinia';
import { useI18n } from 'vue-i18n';
import '@xterm/xterm/css/xterm.css';

const props = defineProps<{
  width?: string;
  height?: string;
}>();

const { t } = useI18n();
const appearanceStore = useAppearanceStore();
const {
  effectiveTerminalTheme,
  currentTerminalFontFamily,
  currentTerminalFontSize,
  terminalTextStrokeEnabled,
  terminalTextStrokeWidth,
  terminalTextStrokeColor,
  terminalTextShadowEnabled,
  terminalTextShadowOffsetX,
  terminalTextShadowOffsetY,
  terminalTextShadowBlur,
  terminalTextShadowColor,
} = storeToRefs(appearanceStore);

const terminalRef = ref<HTMLElement | null>(null);
const terminalInstance = ref<Terminal | null>(null);
const currentPreviewMode = ref<'command' | 'code' | 'text'>('command');
const isLoading = ref(true);
const isInitialized = ref(false);

// 缓存 canvas 元素引用，避免重复查询
let cachedCanvas: HTMLCanvasElement | null = null;

// IntersectionObserver 实例，用于懒加载
let observer: IntersectionObserver | null = null;

// 预览内容模式
type PreviewMode = 'command' | 'code' | 'text';

const previewContents: Record<PreviewMode, string[]> = {
  command: [
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ ls -la',
    'total 48',
    'drwxr-xr-x  6 user  staff   192 Dec 28 10:30 \x1b[1;34m.\x1b[0m',
    'drwxr-xr-x  3 root  wheel    96 Dec 27 09:15 \x1b[1;34m..\x1b[0m',
    '-rw-r--r--  1 user  staff  2145 Dec 28 10:30 \x1b[0;32mpackage.json\x1b[0m',
    '-rw-r--r--  1 user  staff  5892 Dec 28 10:30 \x1b[0;32mREADME.md\x1b[0m',
    'drwxr-xr-x  8 user  staff   256 Dec 28 10:30 \x1b[1;34msrc\x1b[0m',
    '-rw-r--r--  1 user  staff  1024 Dec 28 10:30 \x1b[0;33mconfig.yml\x1b[0m',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ cat example.txt',
    '\x1b[1;33mHello, World!\x1b[0m',
    '\x1b[1;36mThis is a terminal preview.\x1b[0m',
    '\x1b[1;35mColors: \x1b[31mRed \x1b[32mGreen \x1b[33mYellow \x1b[34mBlue \x1b[35mMagenta \x1b[36mCyan\x1b[0m',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
  ],
  code: [
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~/project\x1b[0m$ cat app.js',
    "\x1b[0;33mconst\x1b[0m \x1b[0;36mexpress\x1b[0m = \x1b[0;35mrequire\x1b[0m(\x1b[0;32m'express'\x1b[0m);",
    '\x1b[0;33mconst\x1b[0m \x1b[0;36mapp\x1b[0m = \x1b[0;35mexpress\x1b[0m();',
    '',
    '\x1b[90m// 定义路由\x1b[0m',
    "app.\x1b[0;33mget\x1b[0m(\x1b[0;32m'/'\x1b[0m, (req, res) => {",
    "  res.\x1b[0;33msend\x1b[0m(\x1b[0;32m'Hello World!'\x1b[0m);",
    '});',
    '',
    '\x1b[90m// 启动服务器\x1b[0m',
    'app.\x1b[0;33mlisten\x1b[0m(\x1b[0;35m3000\x1b[0m, () => {',
    "  console.\x1b[0;33mlog\x1b[0m(\x1b[0;32m'Server running on port 3000'\x1b[0m);",
    '});',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~/project\x1b[0m$ ',
  ],
  text: [
    '\x1b[1;36m╔═══════════════════════════════════════╗\x1b[0m',
    '\x1b[1;36m║\x1b[0m   \x1b[1;33mNexus Terminal Preview\x1b[0m           \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╠═══════════════════════════════════════╣\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Font Family: \x1b[0;37mCustomizable\x1b[0m     \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Font Size: \x1b[0;37mAdjustable\x1b[0m         \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Text Stroke: \x1b[0;37mSupported\x1b[0m        \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Text Shadow: \x1b[0;37mSupported\x1b[0m        \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;32m✓\x1b[0m Color Themes: \x1b[0;37mMultiple\x1b[0m        \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╠═══════════════════════════════════════╣\x1b[0m',
    '\x1b[1;36m║\x1b[0m  \x1b[1;35mSupported Colors:\x1b[0m                 \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m    \x1b[0;31m●\x1b[0m Red    \x1b[0;32m●\x1b[0m Green   \x1b[0;33m●\x1b[0m Yellow  \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m║\x1b[0m    \x1b[0;34m●\x1b[0m Blue   \x1b[0;35m●\x1b[0m Magenta \x1b[0;36m●\x1b[0m Cyan    \x1b[1;36m║\x1b[0m',
    '\x1b[1;36m╚═══════════════════════════════════════╝\x1b[0m',
    '',
    '\x1b[1;32muser@nexus-terminal\x1b[0m:\x1b[1;34m~\x1b[0m$ ',
  ],
};

// 创建终端实例（核心逻辑）
const createTerminalInstance = () => {
  if (!terminalRef.value || terminalInstance.value) return;

  const terminal = new Terminal({
    cursorBlink: true,
    fontSize: currentTerminalFontSize.value,
    fontFamily: currentTerminalFontFamily.value,
    theme: effectiveTerminalTheme.value,
    allowProposedApi: true,
    rows: 15,
    cols: 80,
    disableStdin: true,
  });

  terminal.open(terminalRef.value);
  terminalInstance.value = terminal;
  isInitialized.value = true;

  // 应用描边和阴影样式
  applyTextStyles();

  // 写入预览内容（在回调中隐藏加载状态，避免魔法数字延迟）
  writePreviewContent();
};

// 初始化终端实例（使用 IntersectionObserver + requestIdleCallback）
const initTerminal = async () => {
  if (!terminalRef.value || terminalInstance.value) return;

  await nextTick();

  // 使用 requestIdleCallback 在浏览器空闲时初始化
  const initInIdle = () => {
    if (window.requestIdleCallback) {
      window.requestIdleCallback(
        () => {
          createTerminalInstance();
        },
        { timeout: 2000 },
      );
    } else {
      // 降级方案：使用 setTimeout 延迟初始化
      setTimeout(() => {
        createTerminalInstance();
      }, 0);
    }
  };

  // 初始化
  initInIdle();
};

// 应用文字描边和阴影样式（优化：使用缓存的 canvas 引用）
const applyTextStyles = () => {
  if (!terminalRef.value) return;

  // 使用缓存，避免重复查询 DOM
  if (!cachedCanvas) {
    cachedCanvas = terminalRef.value.querySelector('canvas');
  }
  if (!cachedCanvas) return;

  // 直接设置样式属性，避免累积
  if (terminalTextStrokeEnabled.value) {
    cachedCanvas.style.webkitTextStroke = `${terminalTextStrokeWidth.value}px ${terminalTextStrokeColor.value}`;
  } else {
    cachedCanvas.style.webkitTextStroke = '';
  }

  if (terminalTextShadowEnabled.value) {
    cachedCanvas.style.textShadow = `${terminalTextShadowOffsetX.value}px ${terminalTextShadowOffsetY.value}px ${terminalTextShadowBlur.value}px ${terminalTextShadowColor.value}`;
  } else {
    cachedCanvas.style.textShadow = '';
  }
};

// 写入预览内容（优化：批量写入减少重绘 + 使用回调关闭 loading）
const writePreviewContent = () => {
  if (!terminalInstance.value) return;

  terminalInstance.value.clear();

  const content = previewContents[currentPreviewMode.value];
  const payload = content.join('\r\n');

  // 使用 write 回调在内容写入完成后隐藏骨架屏
  // 这样可以避免固定的延迟时间，更加精确
  terminalInstance.value.write(payload, () => {
    // 写入队列 flush 后再隐藏骨架屏
    isLoading.value = false;
  });
};

// 切换预览模式
const switchPreviewMode = (mode: PreviewMode) => {
  currentPreviewMode.value = mode;
  writePreviewContent();
};

// 性能优化：防抖更新终端配置
let updateTimeoutId: number | null = null;
const debouncedUpdateTerminal = () => {
  if (updateTimeoutId !== null) {
    clearTimeout(updateTimeoutId);
  }

  updateTimeoutId = window.setTimeout(() => {
    updateTerminalOptions();
    updateTimeoutId = null;
  }, 150); // 150ms 防抖
};

// 更新终端配置
const updateTerminalOptions = () => {
  if (!terminalInstance.value) return;

  // 使用 requestAnimationFrame 优化渲染性能
  requestAnimationFrame(() => {
    if (!terminalInstance.value) return;

    terminalInstance.value.options.fontSize = currentTerminalFontSize.value;
    terminalInstance.value.options.fontFamily = currentTerminalFontFamily.value;
    terminalInstance.value.options.theme = effectiveTerminalTheme.value;

    applyTextStyles();
  });
};

// 监听配置变化（使用防抖优化）
watch(
  [
    currentTerminalFontFamily,
    currentTerminalFontSize,
    effectiveTerminalTheme,
    terminalTextStrokeEnabled,
    terminalTextStrokeWidth,
    terminalTextStrokeColor,
    terminalTextShadowEnabled,
    terminalTextShadowOffsetX,
    terminalTextShadowOffsetY,
    terminalTextShadowBlur,
    terminalTextShadowColor,
  ],
  () => {
    debouncedUpdateTerminal();
  },
  { deep: false }, // 改为 false，避免深度遍历对象
);

onMounted(() => {
  // 使用 IntersectionObserver 实现懒加载
  // 只有当组件进入视口时才初始化终端
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        // 当组件至少 10% 可见时才初始化
        if (entry.isIntersecting && !terminalInstance.value) {
          initTerminal();

          // 初始化后断开观察，释放资源
          observer?.disconnect();
          observer = null;
        }
      });
    },
    {
      threshold: 0.1, // 10% 可见时触发
      rootMargin: '50px', // 提前 50px 开始加载，提升用户体验
    },
  );

  // 开始观察 DOM 元素
  if (terminalRef.value) {
    observer.observe(terminalRef.value);
  }
});

onBeforeUnmount(() => {
  // 清理 IntersectionObserver
  if (observer) {
    observer.disconnect();
    observer = null;
  }

  // 清理防抖定时器
  if (updateTimeoutId !== null) {
    clearTimeout(updateTimeoutId);
  }

  // 清理终端实例
  if (terminalInstance.value) {
    terminalInstance.value.dispose();
    terminalInstance.value = null;
  }

  // 清理缓存
  cachedCanvas = null;
});

const containerStyle = computed(() => ({
  width: props.width || '100%',
  height: props.height || '400px',
}));

const previewModeButtons = computed(() => [
  { key: 'command' as PreviewMode, label: t('styleCustomizer.previewModeCommand', '命令输出') },
  { key: 'code' as PreviewMode, label: t('styleCustomizer.previewModeCode', '代码高亮') },
  { key: 'text' as PreviewMode, label: t('styleCustomizer.previewModeText', '文本样式') },
]);

// 生成骨架屏线条样式，模拟真实内容
const getSkeletonLineStyle = (index: number) => {
  // 模拟不同长度的行
  const widths = [
    '90%',
    '70%',
    '85%',
    '60%',
    '95%',
    '75%',
    '80%',
    '65%',
    '90%',
    '70%',
    '85%',
    '40%',
  ];
  return {
    width: widths[(index - 1) % widths.length],
  };
};
</script>

<template>
  <div class="terminal-preview-wrapper" :style="containerStyle">
    <div class="terminal-preview-header">
      <div class="terminal-preview-controls">
        <span class="terminal-preview-dot terminal-preview-dot-red"></span>
        <span class="terminal-preview-dot terminal-preview-dot-yellow"></span>
        <span class="terminal-preview-dot terminal-preview-dot-green"></span>
      </div>
    </div>

    <!-- 预览模式切换按钮 -->
    <div class="terminal-preview-mode-switcher">
      <button
        v-for="mode in previewModeButtons"
        :key="mode.key"
        @click="switchPreviewMode(mode.key)"
        :class="['preview-mode-btn', { active: currentPreviewMode === mode.key }]"
        :title="mode.label"
      >
        {{ mode.label }}
      </button>
    </div>

    <!-- 永远存在，保证 ref 可用、observer 可 observe、xterm 可 open -->
    <div ref="terminalRef" class="terminal-preview-content"></div>

    <!-- 骨架屏作为覆盖层，而不是 v-if 替换 -->
    <div v-show="isLoading" class="terminal-preview-skeleton-overlay">
      <div class="skeleton-overlay-bg"></div>
      <div class="skeleton-header">
        <div class="skeleton-dots">
          <span class="skeleton-dot skeleton-dot-red"></span>
          <span class="skeleton-dot skeleton-dot-yellow"></span>
          <span class="skeleton-dot skeleton-dot-green"></span>
        </div>
      </div>

      <div class="skeleton-mode-switcher">
        <div class="skeleton-btn"></div>
        <div class="skeleton-btn"></div>
        <div class="skeleton-btn"></div>
      </div>

      <div class="skeleton-content">
        <div v-for="i in 12" :key="i" class="skeleton-line" :style="getSkeletonLineStyle(i)"></div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 骨架屏覆盖层样式 */
.terminal-preview-skeleton-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 10;
  display: flex;
  flex-direction: column;
  background-color: var(--terminal-preview-bg, #1a1b1e);
  animation: skeleton-fade-in 0.3s ease-in-out;
}

.skeleton-overlay-bg {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: var(--terminal-preview-bg, #1a1b1e);
  opacity: 0.95;
}

.terminal-preview-wrapper {
  position: relative;
  border: 1px solid var(--terminal-border-color, #374151);
  border-radius: 8px;
  overflow: hidden;
  background-color: var(--terminal-preview-bg, #1a1b1e);
}

.terminal-preview-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 12px;
  background-color: var(--terminal-header-bg, #2d2e33);
  border-bottom: 1px solid var(--terminal-border-color, #374151);
}

.terminal-preview-controls {
  display: flex;
  gap: 6px;
}

.terminal-preview-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
}

.terminal-preview-dot-red {
  background-color: var(--danger-color, #ef4444);
}

.terminal-preview-dot-yellow {
  background-color: var(--warning-color, #f59e0b);
}

.terminal-preview-dot-green {
  background-color: var(--success-color, #10b981);
}

.terminal-preview-mode-switcher {
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  background-color: var(--terminal-mode-switcher-bg, #25262b);
  border-bottom: 1px solid var(--terminal-border-color, #374151);
  overflow-x: auto;
}

.preview-mode-btn {
  padding: 4px 12px;
  font-size: 12px;
  border: 1px solid var(--terminal-border-color, #374151);
  border-radius: 4px;
  background-color: var(--terminal-btn-bg, #2d2e33);
  color: var(--terminal-btn-text, #9ca3af);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;
}

.preview-mode-btn:hover {
  background-color: var(--terminal-btn-hover-bg, #3d3e43);
  border-color: var(--terminal-btn-hover-border, #4b5563);
}

.preview-mode-btn.active {
  background-color: var(--primary, #6366f1);
  border-color: var(--primary, #6366f1);
  color: var(--button-text-color, #ffffff);
  font-weight: 500;
}

.terminal-preview-content {
  height: calc(100% - 37px - 41px);
  padding: 8px;
  overflow: hidden;
}

.terminal-preview-content :deep(.xterm) {
  height: 100%;
}

.terminal-preview-content :deep(.xterm .xterm-viewport) {
  overflow-y: auto !important;
}

/* 移动端优化 */
@media (max-width: 768px) {
  .terminal-preview-mode-switcher {
    padding: 6px 8px;
  }

  .preview-mode-btn {
    padding: 3px 8px;
    font-size: 11px;
  }
}

/* 骨架屏内部样式 */
.skeleton-header {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding: 8px 12px;
  background-color: var(--terminal-header-bg, #2d2e33);
  border-bottom: 1px solid var(--terminal-border-color, #374151);
}

.skeleton-dots {
  display: flex;
  gap: 6px;
}

.skeleton-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  animation: skeleton-pulse 1.5s ease-in-out infinite;
}

.skeleton-dot:nth-child(1) {
  background-color: #ef4444;
  animation-delay: 0s;
}

.skeleton-dot:nth-child(2) {
  background-color: #f59e0b;
  animation-delay: 0.2s;
}

.skeleton-dot:nth-child(3) {
  background-color: #10b981;
  animation-delay: 0.4s;
}

.skeleton-mode-switcher {
  position: relative;
  z-index: 1;
  display: flex;
  gap: 4px;
  padding: 8px 12px;
  background-color: var(--terminal-mode-switcher-bg, #25262b);
  border-bottom: 1px solid var(--terminal-border-color, #374151);
}

.skeleton-btn {
  padding: 4px 12px;
  height: 24px;
  border-radius: 4px;
  background: linear-gradient(
    90deg,
    var(--terminal-btn-bg, #2d2e33) 25%,
    var(--terminal-btn-hover-bg, #3d3e43) 50%,
    var(--terminal-btn-bg, #2d2e33) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
  flex-shrink: 0;
}

.skeleton-content {
  position: relative;
  z-index: 1;
  flex: 1;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  overflow: hidden;
}

.skeleton-line {
  height: 16px;
  border-radius: 2px;
  background: linear-gradient(
    90deg,
    var(--terminal-btn-bg, #2d2e33) 25%,
    var(--terminal-btn-hover-bg, #3d3e43) 50%,
    var(--terminal-btn-bg, #2d2e33) 75%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.5s infinite;
}

@keyframes skeleton-pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

@keyframes skeleton-shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

@keyframes skeleton-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
</style>
