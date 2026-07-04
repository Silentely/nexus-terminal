<script setup lang="ts">
import {
  ref,
  onMounted,
  onBeforeUnmount,
  watch,
  nextTick,
  watchEffect,
  computed,
  type PropType,
} from 'vue';
import { useI18n } from 'vue-i18n';
import { Terminal, IDisposable } from '@xterm/xterm';
import { useDeviceDetection } from '../../composables/useDeviceDetection';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useSessionStore } from '../../stores/session.store';
import { storeToRefs } from 'pinia';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import {
  useWorkspaceEventEmitter,
  useWorkspaceEventSubscriber,
  useWorkspaceEventOff,
} from '../../composables/workspaceEvents';

defineOptions({
  name: 'WorkspaceTerminal',
});

const { t } = useI18n();

// Import extracted composables
import { useTerminalFit } from '../../composables/terminal/useTerminalFit';
import { useTerminalSocket } from '../../composables/terminal/useTerminalSocket';
import { useTerminalRenderer } from '../../composables/terminal/useTerminalRenderer';
import { useTouchGestures } from '../../composables/useTouchGestures';
import { OutputEnhancerAddon } from './addons/output-enhancer';
import PerformanceMonitor from './components/PerformanceMonitor.vue';
import { log } from '@/utils/log';

// 定义 props 和 emits
const props = defineProps({
  sessionId: { type: String, required: true }, // 会话 ID
  isActive: Boolean, // 标记此终端是否为活动标签页
  stream: Object as PropType<ReadableStream<string>>, // 用于接收来自 WebSocket 的数据流 (可选)
  options: Object, // xterm 的配置选项
});

const emitWorkspaceEvent = useWorkspaceEventEmitter();
const subscribeToWorkspaceEvent = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvent = useWorkspaceEventOff();

const terminalRef = ref<HTMLElement | null>(null); // xterm 挂载点的引用 (内部容器)
const terminalOuterWrapperRef = ref<HTMLElement | null>(null); // 最外层容器的引用
const terminalInstance = ref<Terminal | null>(null); // 使用 ref 管理 terminal 实例以便传递给 composable
const textareaKeydownHandler = ref<((event: KeyboardEvent) => void) | null>(null);
let searchAddon: SearchAddon | null = null;
let outputEnhancerAddon: OutputEnhancerAddon | null = null;
let selectionListenerDisposable: IDisposable | null = null;

const isActiveRef = ref(props.isActive);
watch(
  () => props.isActive,
  (val) => {
    isActiveRef.value = val;
  },
);
const streamRef = ref(props.stream);
watch(
  () => props.stream,
  (val) => {
    streamRef.value = val;
  },
);

const { isMobile } = useDeviceDetection();

// --- Composables ---
const { fitAddon, fitAndEmitResizeNow, setupResizeObserver } = useTerminalFit(
  terminalInstance,
  terminalRef,
  props.sessionId,
  isActiveRef,
  computed(() => terminalAutoWrapEnabledBoolean.value),
);

const { setupInputHandler } = useTerminalSocket(terminalInstance, props.sessionId, streamRef);

const { contextState, setRenderMode, initRenderer, startMonitoring, stopMonitoring, getMetrics } =
  useTerminalRenderer(terminalInstance, props.sessionId);

// 性能监控面板显示状态 — 由 appearance store 的 isFpsEnabled 驱动
const togglePerformanceMonitor = () => {
  appearanceStore.toggleFps();
};

let initialPinchDistance = 0;
let currentFontSizeOnPinchStart = 0;

// --- Appearance Store ---
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
  initialAppearanceDataLoaded,
  currentRenderMode,
  isFpsEnabled,
} = storeToRefs(appearanceStore);

const isTerminalDomReady = ref(false);

// --- Settings Store ---
const settingsStore = useSettingsStore();
const sessionStore = useSessionStore();
const {
  autoCopyOnSelectBoolean,
  terminalScrollbackLimitNumber,
  terminalAutoWrapEnabledBoolean,
  terminalEnableRightClickPasteBoolean,
  terminalOutputEnhancerEnabledBoolean,
  terminalEnableBracketedPasteBoolean,
} = storeToRefs(settingsStore);

const debounce = <TArgs extends unknown[]>(func: (...args: TArgs) => void, delay: number) => {
  let timeoutId: number | null = null;
  return (...args: TArgs) => {
    if (timeoutId !== null) clearTimeout(timeoutId);
    timeoutId = window.setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delay);
  };
};

// 创建防抖版的字体大小保存函数 (区分设备)
const debouncedSaveFontSize = debounce(async (size: number) => {
  try {
    if (isMobile.value) {
      await appearanceStore.setTerminalFontSizeMobile(size);
      log.info(`[Terminal ${props.sessionId}] Debounced MOBILE font size saved: ${size}`);
    } else {
      await appearanceStore.setTerminalFontSize(size);
      log.info(`[Terminal ${props.sessionId}] Debounced DESKTOP font size saved: ${size}`);
    }
  } catch (error: unknown) {
    log.error(`[Terminal ${props.sessionId}] Debounced font size save failed:`, error);
  }
}, 500);

const getScrollbackValue = (limit: number): number => {
  if (limit === 0) return Infinity;
  return Math.max(0, limit);
};

const sendPastedTextToTerminal = (text: string) => {
  const processedText = text.replace(/\r\n?/g, '\n');
  // 移动端菜单复用桌面粘贴策略，确保 bracketed paste 行为一致。
  const data = terminalEnableBracketedPasteBoolean.value
    ? `\x1b[200~${processedText}\x1b[201~`
    : processedText;
  emitWorkspaceEvent('terminal:input', {
    sessionId: props.sessionId,
    data,
  });
};

const {
  isContextMenuVisible: isTouchContextMenuVisible,
  contextMenuPosition: touchContextMenuPosition,
  hideContextMenu: hideTouchContextMenu,
  handleCopy: handleTouchCopy,
  handlePaste: handleTouchPaste,
  handleSelectAll: handleTouchSelectAll,
  attach: attachTouchGestures,
  detach: detachTouchGestures,
} = useTouchGestures({
  terminal: terminalInstance,
  terminalRef,
  getSelection: () => terminalInstance.value?.getSelection() ?? null,
  pasteText: sendPastedTextToTerminal,
});

const MIN_TERMINAL_COLS_NO_WRAP = 240;

const syncNoWrapContentWidth = (term: Terminal) => {
  const element = term.element as HTMLElement | null;
  if (!element) return;

  if (terminalAutoWrapEnabledBoolean.value) {
    element.style.removeProperty('width');
    const screen = element.querySelector('.xterm-screen') as HTMLElement | null;
    if (screen) screen.style.removeProperty('width');
    return;
  }

  const core = (term as unknown as { _core?: { _renderService?: { dimensions?: unknown } } })._core;
  const dimensions = core?._renderService?.dimensions as
    | { css?: { cell?: { width?: number } } }
    | undefined;
  const cellWidth = dimensions?.css?.cell?.width ?? 0;
  if (!Number.isFinite(cellWidth) || cellWidth <= 0) return;

  const contentWidth = Math.ceil(term.cols * cellWidth);
  if (contentWidth <= 0) return;

  element.style.width = `${contentWidth}px`;
  const screen = element.querySelector('.xterm-screen') as HTMLElement | null;
  if (screen) {
    screen.style.width = `${contentWidth}px`;
  }
};

const applyTerminalWrapMode = () => {
  const term = terminalInstance.value;
  if (!term) return;

  try {
    if (terminalAutoWrapEnabledBoolean.value) {
      fitAndEmitResizeNow();
      syncNoWrapContentWidth(term);
      return;
    }

    // 关闭自动换行时保持更宽列数，并仅让行数随容器高度调整
    const proposed = fitAddon.proposeDimensions();
    const targetRows = proposed?.rows ?? term.rows;
    const targetCols = Math.max(term.cols, proposed?.cols ?? term.cols, MIN_TERMINAL_COLS_NO_WRAP);

    if (targetCols !== term.cols || targetRows !== term.rows) {
      term.resize(targetCols, targetRows);
    }

    fitAndEmitResizeNow();
    syncNoWrapContentWidth(term);
  } catch (error: unknown) {
    log.warn(`[Terminal ${props.sessionId}] Failed to apply terminal wrap mode:`, error);
  }
};

// --- 右键粘贴功能 ---
const handleContextMenuPaste = async (event: MouseEvent) => {
  event.preventDefault();
  const terminal = terminalInstance.value;
  if (!terminal) {
    return;
  }

  const selection = terminal.getSelection();
  // 右键拆分为两步：
  // 1) 有选区 => 复制选区
  // 2) 无选区 => 执行粘贴
  if (selection) {
    try {
      await navigator.clipboard.writeText(selection);
      terminal.clearSelection();
    } catch (err: unknown) {
      log.error('[Terminal] Failed to copy selection via Right Click:', err);
    }
    return;
  }

  try {
    const text = await navigator.clipboard.readText();
    if (text) {
      sendPastedTextToTerminal(text);
    }
  } catch (err: unknown) {
    log.error('[Terminal] Failed to paste via Right Click:', err);
  }
};

const addContextMenuListener = () => {
  if (terminalRef.value) {
    terminalRef.value.addEventListener('contextmenu', handleContextMenuPaste);
  }
};

const removeContextMenuListener = () => {
  if (terminalRef.value) {
    terminalRef.value.removeEventListener('contextmenu', handleContextMenuPaste);
  }
};

// --- 移动端模式下通过双指放大缩小终端字号 ---
const getDistanceBetweenTouches = (touches: TouchList): number => {
  const touch1 = touches[0];
  const touch2 = touches[1];
  return Math.sqrt(
    Math.pow(touch2.clientX - touch1.clientX, 2) + Math.pow(touch2.clientY - touch1.clientY, 2),
  );
};

const handleTouchStart = (event: TouchEvent) => {
  if (event.touches.length === 2 && terminalInstance.value) {
    event.preventDefault();
    initialPinchDistance = getDistanceBetweenTouches(event.touches);
    currentFontSizeOnPinchStart =
      terminalInstance.value.options.fontSize || currentTerminalFontSize.value;
  }
};

const handleTouchMove = (event: TouchEvent) => {
  if (event.touches.length === 2 && terminalInstance.value && initialPinchDistance > 0) {
    event.preventDefault();
    const currentDistance = getDistanceBetweenTouches(event.touches);
    if (currentDistance > 0) {
      const scale = currentDistance / initialPinchDistance;
      let newSize = Math.round(currentFontSizeOnPinchStart * scale);
      newSize = Math.max(8, Math.min(newSize, 72));

      const currentTerminalOptFontSize =
        terminalInstance.value.options.fontSize ?? currentTerminalFontSize.value;
      if (newSize !== currentTerminalOptFontSize) {
        terminalInstance.value.options.fontSize = newSize;
        applyTerminalWrapMode();
        debouncedSaveFontSize(newSize);
      }
    }
  }
};

const handleTouchEnd = (event: TouchEvent) => {
  if (event.touches.length < 2) {
    initialPinchDistance = 0;
  }
};

const handleWheelZoom = (event: WheelEvent) => {
  if (event.ctrlKey) {
    event.preventDefault();
    if (terminalInstance.value) {
      let newSize;
      const currentSize = terminalInstance.value.options.fontSize ?? currentTerminalFontSize.value;
      if (event.deltaY < 0) newSize = Math.min(currentSize + 1, 40);
      else newSize = Math.max(currentSize - 1, 8);

      if (newSize !== currentSize) {
        terminalInstance.value.options.fontSize = newSize;
        applyTerminalWrapMode();
        debouncedSaveFontSize(newSize);
      }
    }
  }
};

// 初始化终端
onMounted(() => {
  if (terminalRef.value) {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: currentTerminalFontSize.value,
      fontFamily: currentTerminalFontFamily.value,
      fontWeight: 'normal',
      fontWeightBold: 'bold',
      letterSpacing: 0,
      lineHeight: 1.0,
      theme: effectiveTerminalTheme.value,
      rows: 24,
      cols: 80,
      allowTransparency: true,
      disableStdin: false,
      convertEol: true,
      scrollback: getScrollbackValue(terminalScrollbackLimitNumber.value),
      scrollOnUserInput: true,
      // 高 DPI 屏幕支持：解决字体发虚问题
      // 使用实际的设备像素比，确保字体清晰渲染
      ...props.options,
      // allowProposedApi 必须在 props.options 之后，确保 Unicode11Addon 始终可用
      allowProposedApi: true,
    });

    terminalInstance.value = term;

    // 先挂载终端 DOM，再加载依赖渲染尺寸的 addon。
    // xterm 的 Fit/WebGL/Unicode 等 addon 可能读取 renderService.dimensions，
    // 在 open() 前加载会导致连接时出现 dimensions undefined。
    term.open(terminalRef.value);
    isTerminalDomReady.value = true;
    log.info(`[Terminal ${props.sessionId}] Xterm open() called.`);

    // Load Addons
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());

    searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);

    // 加载输出增强插件（添加错误处理，避免插件加载失败导致终端崩溃）
    try {
      outputEnhancerAddon = new OutputEnhancerAddon({
        enabled: terminalOutputEnhancerEnabledBoolean.value,
        enableHighlight: true,
        enableTableFormat: true,
        enableLinkDetection: true,
        foldThreshold: 500,
      });
      // OutputEnhancerAddon 只 monkey-patch terminal.write，不依赖 xterm AddonManager。
      // 手动 activate/dispose 可避免 xterm 在整体 dispose 时遇到 addon 管理状态错乱。
      outputEnhancerAddon.activate(term);
      log.info(
        `[Terminal ${props.sessionId}] OutputEnhancerAddon 加载成功 (enabled: ${terminalOutputEnhancerEnabledBoolean.value})`,
      );
    } catch (error: unknown) {
      log.error(
        `[Terminal ${props.sessionId}] OutputEnhancerAddon 加载失败，降级使用原始终端：`,
        error,
      );
      outputEnhancerAddon = null; // 降级：不使用输出增强功能
    }

    // 使用 composable 初始化渲染器（自动选择 WebGL/Canvas/DOM）
    initRenderer();

    // 仅在用户启用 FPS 显示时启动采样，避免无用 RAF 循环
    if (isFpsEnabled.value) {
      startMonitoring();
    }

    applyTerminalWrapMode();

    // Set up Input Handler (from composable)
    setupInputHandler();

    // Set up Resize Observer (from composable)
    setupResizeObserver();

    // Trigger ready event
    emitWorkspaceEvent('terminal:ready', {
      sessionId: props.sessionId,
      terminal: term,
      searchAddon: searchAddon,
    });

    // --- Selection & Copy ---
    let currentSelection = '';
    const handleSelectionChange = () => {
      if (term && autoCopyOnSelectBoolean.value) {
        const newSelection = term.getSelection();
        if (newSelection && newSelection !== currentSelection) {
          currentSelection = newSelection;
          navigator.clipboard.writeText(newSelection).catch((err) => {
            log.error('[Terminal] Auto-copy failed:', err);
          });
        } else if (!newSelection) {
          currentSelection = '';
        }
      } else {
        currentSelection = '';
      }
    };

    const debouncedSelectionChange = debounce(handleSelectionChange, 50);
    selectionListenerDisposable = term.onSelectionChange(debouncedSelectionChange);

    watch(autoCopyOnSelectBoolean, (newValue) => {
      if (!newValue) currentSelection = '';
    });

    // --- Appearance Watchers ---
    watch(
      effectiveTerminalTheme,
      (newTheme) => {
        if (term) {
          try {
            // 安全地更新主题：先设置主题，xterm 会自动触发重绘
            term.options.theme = newTheme;
            // 只有当 WebGL 渲染器可用且上下文未丢失时才手动刷新
            // 否则让 xterm 自己处理重绘（Canvas/DOM 渲染器）
            if (contextState.value === 'active') {
              // WebGL 渲染器活跃，使用 nextTick 延迟刷新以确保状态稳定
              nextTick(() => {
                try {
                  if (term && contextState.value === 'active') {
                    term.refresh(0, term.rows - 1);
                  }
                } catch (refreshError: unknown) {
                  log.warn(
                    `[Terminal ${props.sessionId}] WebGL refresh failed, WebGL context may be lost:`,
                    refreshError,
                  );
                }
              });
            }
            // Canvas/DOM 渲染器会自动处理主题更新，无需手动刷新
          } catch (error: unknown) {
            log.warn(`[Terminal ${props.sessionId}] Theme update failed:`, error);
          }
        }
      },
      { deep: true },
    );

    watch(currentTerminalFontFamily, (newFontFamily) => {
      if (term) {
        term.options.fontFamily = newFontFamily;
        applyTerminalWrapMode();
      }
    });

    watch(currentTerminalFontSize, (newSize) => {
      if (term) {
        term.options.fontSize = newSize;
        applyTerminalWrapMode();
      }
    });

    term.focus();

    // --- Ctrl+Shift+C/V/O (Terminal Actions) ---
    if (term.textarea) {
      const handler = (event: KeyboardEvent) => {
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
          event.preventDefault();
          event.stopPropagation();
          const selection = term?.getSelection();
          if (selection) {
            navigator.clipboard.writeText(selection).catch((err: unknown) => {
              log.error('[Terminal] Copy failed:', err);
            });
          }
        } else if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
          event.preventDefault();
          event.stopPropagation();
          navigator.clipboard
            .readText()
            .then((text) => {
              if (text) {
                const processedText = text.replace(/\r\n?/g, '\n');
                // 根据设置决定是否使用 Bracketed Paste Mode 包裹
                // 关闭 bracketed paste 可解决基础 sh 环境下转义序列显示异常问题
                const data = terminalEnableBracketedPasteBoolean.value
                  ? `\x1b[200~${processedText}\x1b[201~`
                  : processedText;
                emitWorkspaceEvent('terminal:input', {
                  sessionId: props.sessionId,
                  data,
                });
              }
            })
            .catch((err: unknown) => {
              log.error('[Terminal] Paste failed:', err);
            });
        } else if (event.ctrlKey && event.shiftKey && event.code === 'KeyO') {
          // Ctrl+Shift+O: 展开最近折叠的输出
          event.preventDefault();
          event.stopPropagation();
          if (outputEnhancerAddon && outputEnhancerAddon.isEnabled()) {
            const expanded = outputEnhancerAddon.expandLastFold();
            if (!expanded) {
              log.info('[Terminal] No folded content to expand');
            }
          }
        }
      };
      textareaKeydownHandler.value = handler;
      term.textarea.addEventListener('keydown', handler);
    }

    if (terminalEnableRightClickPasteBoolean.value) {
      addContextMenuListener();
    }

    watch(terminalEnableRightClickPasteBoolean, (newValue) => {
      if (newValue) addContextMenuListener();
      else removeContextMenuListener();
    });

    // 监听终端输出增强器设置变化
    watch(terminalOutputEnhancerEnabledBoolean, (newValue) => {
      if (outputEnhancerAddon) {
        outputEnhancerAddon.setEnabled(newValue);
        log.info(`[Terminal ${props.sessionId}] OutputEnhancerAddon enabled: ${newValue}`);
      }
    });

    watch(terminalAutoWrapEnabledBoolean, () => {
      applyTerminalWrapMode();
    });

    // --- 渲染模式响应：外观设置变化时切换渲染器 ---
    watch(currentRenderMode, (newMode) => {
      setRenderMode(newMode);
      log.info(`[Terminal ${props.sessionId}] 渲染模式已切换为: ${newMode}`);
    });

    // --- FPS 监控响应：设置变化时启停采样 ---
    watch(isFpsEnabled, (enabled) => {
      if (enabled) {
        startMonitoring();
      } else {
        stopMonitoring();
      }
    });

    // --- Wheel Zoom ---
    if (terminalRef.value) {
      terminalRef.value.addEventListener('wheel', handleWheelZoom);
    }

    // --- Mobile Pinch Zoom ---
    if (isMobile.value && terminalRef.value && term) {
      terminalRef.value.addEventListener('touchstart', handleTouchStart, { passive: false });
      terminalRef.value.addEventListener('touchmove', handleTouchMove, { passive: false });
      terminalRef.value.addEventListener('touchend', handleTouchEnd, { passive: false });
      terminalRef.value.addEventListener('touchcancel', handleTouchEnd, { passive: false });
      attachTouchGestures();
    }
  }
});

onBeforeUnmount(() => {
  // 停止 FPS 监控（composable 内部也会通过 onBeforeUnmount 清理 WebGL addon）
  stopMonitoring();

  // 清理 textarea keydown 监听器（dispose 前执行，因为 dispose 后 textarea 引用丢失）
  if (textareaKeydownHandler.value && terminalInstance.value?.textarea) {
    terminalInstance.value.textarea.removeEventListener('keydown', textareaKeydownHandler.value);
    textareaKeydownHandler.value = null;
  }

  // OutputEnhancerAddon 未交给 xterm AddonManager，需在 terminal.dispose() 前手动恢复 write。
  if (outputEnhancerAddon) {
    try {
      outputEnhancerAddon.dispose();
    } catch (error: unknown) {
      log.warn(`[Terminal ${props.sessionId}] OutputEnhancerAddon dispose 失败:`, error);
    } finally {
      outputEnhancerAddon = null;
    }
  }

  if (selectionListenerDisposable) {
    try {
      selectionListenerDisposable.dispose();
    } catch (error: unknown) {
      log.warn(`[Terminal ${props.sessionId}] Selection listener dispose 失败:`, error);
    } finally {
      selectionListenerDisposable = null;
    }
  }

  if (terminalInstance.value) {
    try {
      terminalInstance.value.dispose();
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Could not dispose an addon that has not been loaded')) {
        log.debug(`[Terminal ${props.sessionId}] 忽略 xterm addon 重复清理错误: ${errorMessage}`);
      } else {
        log.warn(`[Terminal ${props.sessionId}] xterm dispose 失败，已清理本地引用:`, error);
      }
    } finally {
      terminalInstance.value = null;
      searchAddon = null;
    }
  }

  removeContextMenuListener();

  if (isMobile.value && terminalRef.value) {
    terminalRef.value.removeEventListener('touchstart', handleTouchStart);
    terminalRef.value.removeEventListener('touchmove', handleTouchMove);
    terminalRef.value.removeEventListener('touchend', handleTouchEnd);
    terminalRef.value.removeEventListener('touchcancel', handleTouchEnd);
    detachTouchGestures();
  }

  if (terminalRef.value) {
    terminalRef.value.removeEventListener('wheel', handleWheelZoom);
  }
});

const write = (data: string | Uint8Array) => {
  terminalInstance.value?.write(data);
};

const findNext = (term: string, options?: ISearchOptions): boolean => {
  if (searchAddon) return searchAddon.findNext(term, options);
  return false;
};

const findPrevious = (term: string, options?: ISearchOptions): boolean => {
  if (searchAddon) return searchAddon.findPrevious(term, options);
  return false;
};

const clearSearch = () => {
  searchAddon?.clearDecorations();
};

const clear = () => {
  terminalInstance.value?.clear();
};

defineExpose({ write, findNext, findPrevious, clearSearch, clear });

// --- Styles ---
const applyTerminalTextStyles = () => {
  if (terminalRef.value && terminalInstance.value?.element) {
    const hostElement = terminalRef.value;
    hostElement.classList.remove('has-text-stroke', 'has-text-shadow');

    if (terminalTextStrokeEnabled.value) {
      hostElement.classList.add('has-text-stroke');
      hostElement.style.setProperty(
        '--terminal-stroke-width',
        `${terminalTextStrokeWidth.value}px`,
      );
      hostElement.style.setProperty('--terminal-stroke-color', terminalTextStrokeColor.value);
    } else {
      hostElement.style.removeProperty('--terminal-stroke-width');
      hostElement.style.removeProperty('--terminal-stroke-color');
    }

    if (terminalTextShadowEnabled.value) {
      hostElement.classList.add('has-text-shadow');
      const shadowValue = `${terminalTextShadowOffsetX.value}px ${terminalTextShadowOffsetY.value}px ${terminalTextShadowBlur.value}px ${terminalTextShadowColor.value}`;
      hostElement.style.setProperty('--terminal-shadow', shadowValue);
    } else {
      hostElement.style.removeProperty('--terminal-shadow');
    }
  }
};

watch(
  [
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
    if (isTerminalDomReady.value && initialAppearanceDataLoaded.value) {
      nextTick(() => {
        applyTerminalTextStyles();
      });
    }
  },
  { deep: true },
);

watchEffect(() => {
  if (
    isTerminalDomReady.value &&
    initialAppearanceDataLoaded.value &&
    terminalRef.value &&
    terminalInstance.value?.element
  ) {
    nextTick(() => {
      applyTerminalTextStyles();
    });
  }
});
</script>

<template>
  <div
    ref="terminalOuterWrapperRef"
    class="terminal-outer-wrapper"
    :class="{ 'no-auto-wrap': !terminalAutoWrapEnabledBoolean }"
    role="log"
    :aria-label="t('terminal.output')"
    aria-live="polite"
  >
    <div ref="terminalRef" class="terminal-inner-container"></div>
    <PerformanceMonitor :metrics="getMetrics()" :visible="isFpsEnabled" />
  </div>
  <Teleport to="body">
    <div
      v-if="isTouchContextMenuVisible"
      data-touch-context-menu="true"
      class="terminal-touch-context-menu"
      :style="{
        left: `${touchContextMenuPosition.x}px`,
        top: `${touchContextMenuPosition.y}px`,
      }"
      @touchstart.stop
      @click.stop
    >
      <button type="button" @click="handleTouchCopy">{{ t('common.copy', '复制') }}</button>
      <button type="button" @click="handleTouchPaste">{{ t('common.paste', '粘贴') }}</button>
      <button type="button" @click="handleTouchSelectAll">
        {{ t('common.selectAll', '全选') }}
      </button>
      <button type="button" @click="hideTouchContextMenu">{{ t('common.cancel', '取消') }}</button>
    </div>
  </Teleport>
</template>

<style scoped>
.terminal-outer-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.terminal-outer-wrapper.no-auto-wrap {
  overflow-x: auto;
  overflow-y: hidden;
}

.terminal-inner-container {
  width: 100%;
  height: 100%;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.terminal-inner-container :deep(.xterm) {
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

.terminal-inner-container :deep(.xterm-screen canvas) {
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
}

.terminal-touch-context-menu {
  position: fixed;
  z-index: 3000;
  min-width: 132px;
  padding: 6px;
  border: 1px solid var(--border-color);
  border-radius: 8px;
  background: var(--header-bg-color);
  box-shadow: 0 8px 24px rgb(0 0 0 / 22%);
  transform: translate(-8px, -8px);
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.terminal-touch-context-menu button {
  min-height: 36px;
  padding: 0 12px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--text-color);
  font-size: 14px;
  line-height: 1.2;
  text-align: left;
}

.terminal-touch-context-menu button:active {
  background: var(--nav-item-active-bg-color);
}

.terminal-outer-wrapper.no-auto-wrap :deep(.xterm-viewport) {
  overflow-x: auto;
  overflow-y: scroll;
}

.terminal-outer-wrapper.no-auto-wrap :deep(.xterm-screen) {
  min-width: max-content;
}

.terminal-inner-container.has-text-stroke :deep(.xterm-rows span),
.terminal-inner-container.has-text-stroke :deep(.xterm-rows div > span),
.terminal-inner-container.has-text-stroke :deep(.xterm-rows div) {
  -webkit-text-stroke-width: var(--terminal-stroke-width);
  -webkit-text-stroke-color: var(--terminal-stroke-color);
  text-stroke-width: var(--terminal-stroke-width);
  text-stroke-color: var(--terminal-stroke-color);
  paint-order: stroke fill;
  -webkit-paint-order: stroke fill;
}

.terminal-inner-container.has-text-shadow :deep(.xterm-rows span),
.terminal-inner-container.has-text-shadow :deep(.xterm-rows div > span),
.terminal-inner-container.has-text-shadow :deep(.xterm-rows div) {
  text-shadow: var(--terminal-shadow);
}
</style>
