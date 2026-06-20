import { onBeforeUnmount, nextTick, watch, type Ref } from 'vue';
import type { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWorkspaceEventEmitter } from '../workspaceEvents';
import { log } from '@/utils/log';

export function useTerminalFit(
  terminal: Ref<Terminal | null>,
  terminalRef: Ref<HTMLElement | null>,
  sessionId: string,
  isActive: Ref<boolean>,
  shouldFitByWidth: Ref<boolean>,
) {
  const emitWorkspaceEvent = useWorkspaceEventEmitter();
  const fitAddon = new FitAddon();
  let resizeObserver: ResizeObserver | null = null;
  let observedElement: HTMLElement | null = null;
  let lastResizeObserverWidth = 0;
  let lastResizeObserverHeight = 0;
  const RESIZE_THRESHOLD = 0.5;

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

  const debouncedEmitResize = debounce((term: Terminal) => {
    if (term && isActive.value) {
      const dimensions = { cols: term.cols, rows: term.rows };
      log.info(`[Terminal ${sessionId}] Debounced resize emit:`, dimensions);
      emitWorkspaceEvent('terminal:resize', { sessionId, dims: dimensions });
      try {
        term.refresh(0, term.rows - 1);
      } catch (error: unknown) {
        log.warn(`[Terminal ${sessionId}] Refresh failed:`, error);
      }
    }
  }, 150);

  const fitAndEmitResizeNow = () => {
    if (!terminal.value || !terminalRef.value) return;
    try {
      if (terminalRef.value.offsetHeight > 0 && terminalRef.value.offsetWidth > 0) {
        if (shouldFitByWidth.value) {
          fitAddon.fit();
        } else {
          // 非自动换行模式下仅调整行数，保持列数不被容器宽度强制收缩
          const proposed = fitAddon.proposeDimensions();
          if (proposed && terminal.value.rows !== proposed.rows) {
            terminal.value.resize(terminal.value.cols, proposed.rows);
          }
        }
        const dimensions = { cols: terminal.value.cols, rows: terminal.value.rows };
        emitWorkspaceEvent('terminal:resize', { sessionId, dims: dimensions });
        emitWorkspaceEvent('terminal:stabilizedResize', {
          sessionId,
          width: terminalRef.value.offsetWidth,
          height: terminalRef.value.offsetHeight,
        });

        nextTick(() => {
          if (terminal.value && terminalRef.value) {
            window.dispatchEvent(new Event('resize'));
          }
        });
      }
    } catch (error: unknown) {
      log.warn('Immediate fit/resize failed:', error);
    }
  };

  const setupResizeObserver = () => {
    if (terminalRef.value) {
      observedElement = terminalRef.value;
      resizeObserver = new ResizeObserver((entries) => {
        if (!isActive.value || !terminal.value || !terminalRef.value) return;

        const entry = entries[0];
        const { height: rectHeight, width: rectWidth } = entry.contentRect;

        const widthChanged = Math.abs(rectWidth - lastResizeObserverWidth) >= RESIZE_THRESHOLD;
        const heightChanged = Math.abs(rectHeight - lastResizeObserverHeight) >= RESIZE_THRESHOLD;

        if (!widthChanged && !heightChanged) return;

        const roundedWidth = Math.round(rectWidth);
        const roundedHeight = Math.round(rectHeight);
        lastResizeObserverWidth = roundedWidth;
        lastResizeObserverHeight = roundedHeight;

        if (rectHeight > 0 && rectWidth > 0) {
          if (shouldFitByWidth.value) {
            fitAddon.fit();
          } else {
            // 非自动换行模式下仅根据高度调整 rows，cols 由终端自身保持
            const proposed = fitAddon.proposeDimensions();
            if (proposed && terminal.value.rows !== proposed.rows) {
              terminal.value.resize(terminal.value.cols, proposed.rows);
            }
          }
          debouncedEmitResize(terminal.value);
          emitWorkspaceEvent('terminal:stabilizedResize', {
            sessionId,
            width: roundedWidth,
            height: roundedHeight,
          });
        }
      });

      if (isActive.value) {
        resizeObserver.observe(observedElement);
      }
    }
  };

  watch(isActive, (newValue) => {
    if (resizeObserver && observedElement) {
      if (newValue) {
        resizeObserver.observe(observedElement);
        nextTick(() => {
          setTimeout(() => {
            if (
              isActive.value &&
              terminal.value &&
              terminalRef.value &&
              terminalRef.value.offsetHeight > 0
            ) {
              fitAndEmitResizeNow();
              terminal.value.focus();
            }
          }, 50);
        });
      } else {
        resizeObserver.unobserve(observedElement);
      }
    }
  });

  onBeforeUnmount(() => {
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }
  });

  return {
    fitAddon,
    fitAndEmitResizeNow,
    setupResizeObserver,
  };
}
