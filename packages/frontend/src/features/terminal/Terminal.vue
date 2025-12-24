<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, watchEffect, type PropType } from 'vue';
import { Terminal, IDisposable } from 'xterm';
import { useDeviceDetection } from '../../composables/useDeviceDetection';
import { useAppearanceStore } from '../../stores/appearance.store';
import { useSettingsStore } from '../../stores/settings.store';
import { useSessionStore } from '../../stores/session.store';
import { storeToRefs } from 'pinia';
import { WebLinksAddon } from 'xterm-addon-web-links';
import { SearchAddon, type ISearchOptions } from '@xterm/addon-search';
import { WebglAddon } from '@xterm/addon-webgl';
import 'xterm/css/xterm.css';
import {
  useWorkspaceEventEmitter,
  useWorkspaceEventSubscriber,
  useWorkspaceEventOff,
} from '../../composables/workspaceEvents';

// Import extracted composables
import { useTerminalFit } from '../../composables/terminal/useTerminalFit';
import { useTerminalSocket } from '../../composables/terminal/useTerminalSocket';
import { useNL2CMD } from '../../composables/terminal/useNL2CMD';
import { OutputEnhancerAddon } from './addons/output-enhancer';

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
let searchAddon: SearchAddon | null = null;
let outputEnhancerAddon: OutputEnhancerAddon | null = null;
let selectionListenerDisposable: IDisposable | null = null;
let webglAddonInstance: WebglAddon | null = null; // 保存 WebGL addon 引用以便检查状态

const isActiveRef = ref(props.isActive);
watch(
  () => props.isActive,
  (val) => {
    isActiveRef.value = val;
  }
);
const streamRef = ref(props.stream);
watch(
  () => props.stream,
  (val) => {
    streamRef.value = val;
  }
);

const { isMobile } = useDeviceDetection();

// --- Composables ---
const { fitAddon, fitAndEmitResizeNow, setupResizeObserver } = useTerminalFit(
  terminalInstance,
  terminalRef,
  props.sessionId,
  isActiveRef
);

const { setupInputHandler } = useTerminalSocket(terminalInstance, props.sessionId, streamRef);

// NL2CMD (Natural Language to Command)
const nl2cmd = useNL2CMD();
const {
  isVisible: nl2cmdVisible,
  query: nl2cmdQuery,
  isLoading: nl2cmdLoading,
  isAIEnabled: isNL2CMDEnabled,
  show: showNL2CMD,
  hide: hideNL2CMD,
  generateCommand: generateNL2CMD,
} = nl2cmd;
const nl2cmdInputRef = ref<HTMLTextAreaElement | null>(null);

const openNL2CMDPanel = () => {
  showNL2CMD();
  nextTick(() => {
    nl2cmdInputRef.value?.focus();
  });
};

const closeNL2CMDPanel = () => {
  hideNL2CMD();
};

const submitNL2CMD = async () => {
  const command = await generateNL2CMD();
  if (command) {
    emitWorkspaceEvent('terminal:input', {
      sessionId: props.sessionId,
      data: command,
    });
  }
};

const handleNL2CMDTextareaKeydown = async (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    event.preventDefault();
    await submitNL2CMD();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    closeNL2CMDPanel();
  }
};

watch(
  () => nl2cmdVisible.value,
  (visible) => {
    if (visible) {
      nextTick(() => {
        nl2cmdInputRef.value?.focus();
      });
    }
  }
);

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
} = storeToRefs(appearanceStore);

const isTerminalDomReady = ref(false);

// --- Settings Store ---
const settingsStore = useSettingsStore();
const sessionStore = useSessionStore();
const {
  autoCopyOnSelectBoolean,
  terminalScrollbackLimitNumber,
  terminalEnableRightClickPasteBoolean,
  terminalOutputEnhancerEnabledBoolean,
} = storeToRefs(settingsStore);

const debounce = (func: Function, delay: number) => {
  let timeoutId: number | null = null;
  return (...args: any[]) => {
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
      console.log(`[Terminal ${props.sessionId}] Debounced MOBILE font size saved: ${size}`);
    } else {
      await appearanceStore.setTerminalFontSize(size);
      console.log(`[Terminal ${props.sessionId}] Debounced DESKTOP font size saved: ${size}`);
    }
  } catch (error) {
    console.error(`[Terminal ${props.sessionId}] Debounced font size save failed:`, error);
  }
}, 500);

const getScrollbackValue = (limit: number): number => {
  if (limit === 0) return Infinity;
  return Math.max(0, limit);
};

// --- 右键粘贴功能 ---
const handleContextMenuPaste = async (event: MouseEvent) => {
  event.preventDefault();
  try {
    const text = await navigator.clipboard.readText();
    if (text && terminalInstance.value) {
      const processedText = text.replace(/\r\n?/g, '\n');
      emitWorkspaceEvent('terminal:input', { sessionId: props.sessionId, data: processedText });
    }
  } catch (err) {
    console.error('[Terminal] Failed to paste via Right Click:', err);
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
    Math.pow(touch2.clientX - touch1.clientX, 2) + Math.pow(touch2.clientY - touch1.clientY, 2)
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
        fitAndEmitResizeNow();
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
    });

    terminalInstance.value = term;

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
      term.loadAddon(outputEnhancerAddon);
      console.log(
        `[Terminal ${props.sessionId}] OutputEnhancerAddon 加载成功 (enabled: ${terminalOutputEnhancerEnabledBoolean.value})`
      );
    } catch (error) {
      console.error(
        `[Terminal ${props.sessionId}] OutputEnhancerAddon 加载失败，降级使用原始终端：`,
        error
      );
      outputEnhancerAddon = null; // 降级：不使用输出增强功能
    }

    try {
      webglAddonInstance = new WebglAddon();
      webglAddonInstance.onContextLoss(() => {
        console.warn(
          `[Terminal ${props.sessionId}] WebGL context lost. Falling back to DOM renderer.`
        );
        if (webglAddonInstance) {
          webglAddonInstance.dispose();
          webglAddonInstance = null; // 清除引用，标记上下文已丢失
        }
      });
      term.loadAddon(webglAddonInstance);
      console.log(`[Terminal ${props.sessionId}] WebGL renderer enabled.`);
    } catch (e) {
      console.warn(
        `[Terminal ${props.sessionId}] WebGL addon failed to load, falling back to canvas/dom renderer:`,
        e
      );
      webglAddonInstance = null;
    }

    term.open(terminalRef.value);
    isTerminalDomReady.value = true;
    console.log(`[Terminal ${props.sessionId}] Xterm open() called.`);

    fitAndEmitResizeNow(); // Use composable method

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
            console.error('[Terminal] Auto-copy failed:', err);
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
            if (webglAddonInstance) {
              // WebGL 渲染器存在，使用 nextTick 延迟刷新以确保状态稳定
              nextTick(() => {
                try {
                  if (term && webglAddonInstance) {
                    term.refresh(0, term.rows - 1);
                  }
                } catch (refreshError) {
                  console.warn(
                    `[Terminal ${props.sessionId}] WebGL refresh failed, WebGL context may be lost:`,
                    refreshError
                  );
                  // WebGL 上下文可能已丢失，清理引用
                  if (webglAddonInstance) {
                    try {
                      webglAddonInstance.dispose();
                    } catch {
                      // 忽略 dispose 错误
                    }
                    webglAddonInstance = null;
                  }
                }
              });
            }
            // Canvas/DOM 渲染器会自动处理主题更新，无需手动刷新
          } catch (e) {
            console.warn(`[Terminal ${props.sessionId}] Theme update failed:`, e);
          }
        }
      },
      { deep: true }
    );

    watch(currentTerminalFontFamily, (newFontFamily) => {
      if (term) {
        term.options.fontFamily = newFontFamily;
        fitAndEmitResizeNow();
      }
    });

    watch(currentTerminalFontSize, (newSize) => {
      if (term) {
        term.options.fontSize = newSize;
        fitAndEmitResizeNow();
      }
    });

    term.focus();

    // --- Ctrl+Shift+C/V/O / Ctrl+I (NL2CMD) ---
    if (term.textarea) {
      term.textarea.addEventListener('keydown', async (event: KeyboardEvent) => {
        if (event.ctrlKey && event.shiftKey && event.code === 'KeyC') {
          event.preventDefault();
          event.stopPropagation();
          const selection = term?.getSelection();
          if (selection) {
            try {
              await navigator.clipboard.writeText(selection);
            } catch (err) {
              console.error('[Terminal] Copy failed:', err);
            }
          }
        } else if (event.ctrlKey && event.shiftKey && event.code === 'KeyV') {
          event.preventDefault();
          event.stopPropagation();
          try {
            const text = await navigator.clipboard.readText();
            if (text) {
              const processedText = text.replace(/\r\n?/g, '\n');
              emitWorkspaceEvent('terminal:input', {
                sessionId: props.sessionId,
                data: processedText,
              });
            }
          } catch (err) {
            console.error('[Terminal] Paste failed:', err);
          }
        } else if (event.ctrlKey && event.shiftKey && event.code === 'KeyO') {
          // Ctrl+Shift+O: 展开最近折叠的输出
          event.preventDefault();
          event.stopPropagation();
          if (outputEnhancerAddon && outputEnhancerAddon.isEnabled()) {
            const expanded = outputEnhancerAddon.expandLastFold();
            if (!expanded) {
              console.log('[Terminal] No folded content to expand');
            }
          }
        } else if (event.ctrlKey && !event.shiftKey && event.code === 'KeyI') {
          // Ctrl+I: 唤起 NL2CMD (Natural Language to Command)
          event.preventDefault();
          event.stopPropagation();
          openNL2CMDPanel();
        }
      });
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
        console.log(`[Terminal ${props.sessionId}] OutputEnhancerAddon enabled: ${newValue}`);
      }
    });

    // --- Wheel Zoom ---
    if (terminalRef.value) {
      terminalRef.value.addEventListener('wheel', (event: WheelEvent) => {
        if (event.ctrlKey) {
          event.preventDefault();
          if (term) {
            let newSize;
            const currentSize = term.options.fontSize ?? currentTerminalFontSize.value;
            if (event.deltaY < 0) newSize = Math.min(currentSize + 1, 40);
            else newSize = Math.max(currentSize - 1, 8);

            if (newSize !== currentSize) {
              term.options.fontSize = newSize;
              fitAndEmitResizeNow();
              debouncedSaveFontSize(newSize);
            }
          }
        }
      });
    }

    // --- Mobile Pinch Zoom ---
    if (isMobile.value && terminalRef.value && term) {
      terminalRef.value.addEventListener('touchstart', handleTouchStart, { passive: false });
      terminalRef.value.addEventListener('touchmove', handleTouchMove, { passive: false });
      terminalRef.value.addEventListener('touchend', handleTouchEnd, { passive: false });
      terminalRef.value.addEventListener('touchcancel', handleTouchEnd, { passive: false });
    }
  }
});

onBeforeUnmount(() => {
  // 先清理 WebGL addon（在 terminal dispose 之前）
  if (webglAddonInstance) {
    try {
      webglAddonInstance.dispose();
    } catch {
      // 忽略 dispose 错误
    }
    webglAddonInstance = null;
  }

  if (terminalInstance.value) {
    terminalInstance.value.dispose();
    terminalInstance.value = null;
  }

  // 显式调用 dispose() 清理资源，然后设置为 null
  if (outputEnhancerAddon) {
    outputEnhancerAddon.dispose();
    outputEnhancerAddon = null;
  }

  if (selectionListenerDisposable) {
    selectionListenerDisposable.dispose();
  }

  removeContextMenuListener();

  if (isMobile.value && terminalRef.value) {
    terminalRef.value.removeEventListener('touchstart', handleTouchStart);
    terminalRef.value.removeEventListener('touchmove', handleTouchMove);
    terminalRef.value.removeEventListener('touchend', handleTouchEnd);
    terminalRef.value.removeEventListener('touchcancel', handleTouchEnd);
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
        `${terminalTextStrokeWidth.value}px`
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
  { deep: true }
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
  <div ref="terminalOuterWrapperRef" class="terminal-outer-wrapper">
    <div class="terminal-toolbar">
      <button
        type="button"
        class="nl2cmd-trigger"
        @click="openNL2CMDPanel"
        :disabled="!isNL2CMDEnabled"
        :title="isNL2CMDEnabled ? 'Ctrl+I 唤起 AI 指令生成' : '请在设置中启用 AI 助手'"
      >
        <span class="trigger-icon">✨</span>
        <span>AI 命令</span>
        <span class="trigger-shortcut">Ctrl+I</span>
      </button>
    </div>

    <div ref="terminalRef" class="terminal-inner-container"></div>

    <transition name="nl2cmd-fade">
      <div
        v-if="nl2cmdVisible"
        class="nl2cmd-overlay"
        @click.self="closeNL2CMDPanel"
      >
        <div class="nl2cmd-content">
          <div class="nl2cmd-header">
            <h3 class="nl2cmd-title">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="20"
                height="20"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                class="nl2cmd-icon"
              >
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"></path>
                <line x1="12" x2="12" y1="19" y2="22"></line>
              </svg>
              自然语言指令生成
            </h3>
            <button class="nl2cmd-close" @click="closeNL2CMDPanel" title="关闭 (Esc)">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <line x1="18" x2="6" y1="6" y2="18"></line>
                <line x1="6" x2="18" y1="6" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="nl2cmd-body">
            <label class="nl2cmd-label">请输入自然语言描述：</label>
            <textarea
              ref="nl2cmdInputRef"
              v-model="nl2cmdQuery"
              class="nl2cmd-textarea"
              placeholder="例如：查找当前目录下大于 100M 的文件并按大小排序"
              rows="3"
              @keydown="handleNL2CMDTextareaKeydown"
            ></textarea>
            <div class="nl2cmd-hint">
              提示：按 <kbd>Ctrl+Enter</kbd> 生成命令，<kbd>Esc</kbd> 关闭
            </div>
          </div>
          <div class="nl2cmd-footer">
            <button
              class="nl2cmd-btn nl2cmd-btn-primary"
              @click="submitNL2CMD"
              :disabled="nl2cmdLoading"
            >
              <span v-if="!nl2cmdLoading">生成命令</span>
              <span v-else>生成中...</span>
            </button>
            <button class="nl2cmd-btn nl2cmd-btn-secondary" @click="closeNL2CMDPanel">
              取消
            </button>
          </div>
        </div>
      </div>
    </transition>
    </div>
    </template>

<style scoped>
.terminal-outer-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.terminal-toolbar {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 10;
}

.nl2cmd-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: rgba(255, 255, 255, 0.1);
  backdrop-filter: blur(4px);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 6px;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nl2cmd-trigger:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.2);
  border-color: rgba(255, 255, 255, 0.3);
}

.nl2cmd-trigger:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.trigger-icon {
  font-size: 16px;
}

.trigger-shortcut {
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 3px;
  font-size: 11px;
  font-family: monospace;
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

/* NL2CMD Panel Styles */
.nl2cmd-fade-enter-active,
.nl2cmd-fade-leave-active {
  transition: opacity 0.3s ease;
}

.nl2cmd-fade-enter-from,
.nl2cmd-fade-leave-to {
  opacity: 0;
}

.nl2cmd-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.65);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.nl2cmd-content {
  background: #1e1e1e;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  width: 100%;
  max-width: 600px;
  overflow: hidden;
}

.nl2cmd-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
}

.nl2cmd-title {
  display: flex;
  align-items: center;
  gap: 10px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}

.nl2cmd-icon {
  flex-shrink: 0;
}

.nl2cmd-close {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 6px;
  background: transparent;
  border: none;
  color: #fff;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s ease;
}

.nl2cmd-close:hover {
  background: rgba(255, 255, 255, 0.2);
}

.nl2cmd-body {
  padding: 20px;
}

.nl2cmd-label {
  display: block;
  margin-bottom: 10px;
  font-size: 14px;
  font-weight: 500;
  color: #ddd;
}

.nl2cmd-textarea {
  width: 100%;
  padding: 12px;
  background: #2a2a2a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  color: #fff;
  font-size: 14px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  resize: vertical;
  transition: border-color 0.2s ease;
}

.nl2cmd-textarea:focus {
  outline: none;
  border-color: #667eea;
}

.nl2cmd-textarea::placeholder {
  color: rgba(255, 255, 255, 0.4);
}

.nl2cmd-hint {
  margin-top: 10px;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.6);
}

.nl2cmd-hint kbd {
  display: inline-block;
  padding: 2px 6px;
  background: #2a2a2a;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  font-family: monospace;
  font-size: 11px;
  color: #fff;
}

.nl2cmd-footer {
  display: flex;
  gap: 10px;
  padding: 16px 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
  background: #1a1a1a;
}

.nl2cmd-btn {
  flex: 1;
  padding: 10px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.nl2cmd-btn-primary {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
}

.nl2cmd-btn-primary:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
}

.nl2cmd-btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.nl2cmd-btn-secondary {
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #ddd;
}

.nl2cmd-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.1);
}
</style>
