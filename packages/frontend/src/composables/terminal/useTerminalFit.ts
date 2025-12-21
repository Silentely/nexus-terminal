import { onBeforeUnmount, nextTick, watch, type Ref } from 'vue';
import type { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useWorkspaceEventEmitter } from '../../composables/workspaceEvents';

export function useTerminalFit(
  terminal: Ref<Terminal | null>,
  terminalRef: Ref<HTMLElement | null>,
  sessionId: string,
  isActive: Ref<boolean>
) {
  const emitWorkspaceEvent = useWorkspaceEventEmitter();
  const fitAddon = new FitAddon();
  let resizeObserver: ResizeObserver | null = null;
  let observedElement: HTMLElement | null = null;
  let lastResizeObserverWidth = 0;
  let lastResizeObserverHeight = 0;
  const RESIZE_THRESHOLD = 0.5;

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

  const debouncedEmitResize = debounce((term: Terminal) => {
    if (term && isActive.value) {
      const dimensions = { cols: term.cols, rows: term.rows };
      console.log(`[Terminal ${sessionId}] Debounced resize emit:`, dimensions);
      emitWorkspaceEvent('terminal:resize', { sessionId, dims: dimensions });
      try {
        term.refresh(0, term.rows - 1);
      } catch (e) {
        console.warn(`[Terminal ${sessionId}] Refresh failed:`, e);
      }
    }
  }, 150);

  const fitAndEmitResizeNow = () => {
    if (!terminal.value || !terminalRef.value) return;
    try {
      if (terminalRef.value.offsetHeight > 0 && terminalRef.value.offsetWidth > 0) {
        fitAddon.fit();
        const dimensions = { cols: terminal.value.cols, rows: terminal.value.rows };
        emitWorkspaceEvent('terminal:resize', { sessionId, dims: dimensions });
        emitWorkspaceEvent('terminal:stabilizedResize', { 
            sessionId, 
            width: terminalRef.value.offsetWidth, 
            height: terminalRef.value.offsetHeight 
        });

        nextTick(() => {
          if (terminal.value && terminalRef.value) {
             window.dispatchEvent(new Event('resize'));
          }
        });
      }
    } catch (e) {
      console.warn("Immediate fit/resize failed:", e);
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
           fitAddon.fit();
           debouncedEmitResize(terminal.value);
           emitWorkspaceEvent('terminal:stabilizedResize', { sessionId, width: roundedWidth, height: roundedHeight });
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
                    if (isActive.value && terminal.value && terminalRef.value && terminalRef.value.offsetHeight > 0) {
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
    setupResizeObserver
  };
}
