<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick, watchEffect } from 'vue';
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
import { useWorkspaceEventEmitter, useWorkspaceEventSubscriber, useWorkspaceEventOff } from '../../composables/workspaceEvents';

// Import extracted composables
import { useTerminalFit } from '../../composables/terminal/useTerminalFit';
import { useTerminalSocket } from '../../composables/terminal/useTerminalSocket';

// 定义 props 和 emits
const props = defineProps({
  sessionId: String, // 会话 ID
  isActive: Boolean, // 标记此终端是否为活动标签页
  stream: Object, // 用于接收来自 WebSocket 的数据流 (可选)
  options: Object, // xterm 的配置选项
});

const emitWorkspaceEvent = useWorkspaceEventEmitter();
const subscribeToWorkspaceEvent = useWorkspaceEventSubscriber();
const unsubscribeFromWorkspaceEvent = useWorkspaceEventOff();

const terminalRef = ref<HTMLElement | null>(null); // xterm 挂载点的引用 (内部容器)
const terminalOuterWrapperRef = ref<HTMLElement | null>(null); // 最外层容器的引用
const terminalInstance = ref<Terminal | null>(null); // 使用 ref 管理 terminal 实例以便传递给 composable
let searchAddon: SearchAddon | null = null;
let selectionListenerDisposable: IDisposable | null = null;

const isActiveRef = ref(props.isActive);
watch(() => props.isActive, (val) => { isActiveRef.value = val; });
const streamRef = ref(props.stream);
watch(() => props.stream, (val) => { streamRef.value = val; });

const { isMobile } = useDeviceDetection();

// --- Composables ---
const { fitAddon, fitAndEmitResizeNow, setupResizeObserver } = useTerminalFit(
    terminalInstance, 
    terminalRef, 
    props.sessionId,
    isActiveRef
);

const { setupInputHandler } = useTerminalSocket(
    terminalInstance,
    props.sessionId,
    streamRef
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
    Math.pow(touch2.clientX - touch1.clientX, 2) +
    Math.pow(touch2.clientY - touch1.clientY, 2)
  );
};

const handleTouchStart = (event: TouchEvent) => {
  if (event.touches.length === 2 && terminalInstance.value) {
    event.preventDefault(); 
    initialPinchDistance = getDistanceBetweenTouches(event.touches);
    currentFontSizeOnPinchStart = terminalInstance.value.options.fontSize || currentTerminalFontSize.value;
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

      const currentTerminalOptFontSize = terminalInstance.value.options.fontSize ?? currentTerminalFontSize.value;
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
      theme: effectiveTerminalTheme.value,
      rows: 24,
      cols: 80,
      allowTransparency: true,
      disableStdin: false,
      convertEol: true,
      scrollback: getScrollbackValue(terminalScrollbackLimitNumber.value),
      scrollOnUserInput: true,
      ...props.options,
    });
    
    terminalInstance.value = term;

    // Load Addons
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    
    searchAddon = new SearchAddon();
    term.loadAddon(searchAddon);

    try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
            console.warn(`[Terminal ${props.sessionId}] WebGL context lost. Falling back to DOM renderer.`);
            webglAddon.dispose();
        });
        term.loadAddon(webglAddon);
        console.log(`[Terminal ${props.sessionId}] WebGL renderer enabled.`);
    } catch (e) {
        console.warn(`[Terminal ${props.sessionId}] WebGL addon failed to load, falling back to canvas/dom renderer:`, e);
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
    emitWorkspaceEvent('terminal:ready', { sessionId: props.sessionId, terminal: term, searchAddon: searchAddon });

    // --- Selection & Copy ---
    let currentSelection = '';
    const handleSelectionChange = () => {
        if (term && autoCopyOnSelectBoolean.value) {
            const newSelection = term.getSelection();
            if (newSelection && newSelection !== currentSelection) {
                currentSelection = newSelection;
                navigator.clipboard.writeText(newSelection).catch(err => {
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
    watch(effectiveTerminalTheme, (newTheme) => {
      if (term) {
        term.options.theme = newTheme;
        try {
            term.refresh(0, term.rows - 1);
        } catch (e) {
            console.warn(`[Terminal ${props.sessionId}] Refresh failed:`, e);
        }
      }
    }, { deep: true });

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

    // --- Ctrl+Shift+C/V ---
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
                        emitWorkspaceEvent('terminal:input', { sessionId: props.sessionId, data: processedText });
                    }
                } catch (err) {
                    console.error('[Terminal] Paste failed:', err);
                }
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
  if (terminalInstance.value) {
    terminalInstance.value.dispose();
    terminalInstance.value = null;
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
      hostElement.style.setProperty('--terminal-stroke-width', `${terminalTextStrokeWidth.value}px`);
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
      nextTick(() => { applyTerminalTextStyles(); });
    }
  },
  { deep: true }
);
 
watchEffect(() => {
  if (isTerminalDomReady.value && initialAppearanceDataLoaded.value && terminalRef.value && terminalInstance.value?.element) {
    nextTick(() => { applyTerminalTextStyles(); });
  }
});
 
</script>

<template>
  <div ref="terminalOuterWrapperRef" class="terminal-outer-wrapper">
    <div ref="terminalRef" class="terminal-inner-container"></div>
  </div>
</template>

<style scoped>
.terminal-outer-wrapper {
  width: 100%;
  height: 100%;
  overflow: hidden;
  position: relative;
}

.terminal-inner-container {
  width: 100%;
  height: 100%;
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