import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { useTouchGestures } from './useTouchGestures';

interface TouchPointInit {
  clientX: number;
  clientY: number;
  identifier?: number;
}

interface FakeTerminal {
  rows: number;
  scrollLines: (lines: number) => void;
}

const createTouchEvent = (type: string, points: TouchPointInit[]): TouchEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const touches = points.map((point: TouchPointInit, index: number) => ({
    identifier: point.identifier ?? index,
    clientX: point.clientX,
    clientY: point.clientY,
  })) as unknown as TouchList;

  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'targetTouches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });

  return event;
};

describe('useTouchGestures', () => {
  let element: HTMLDivElement;
  let terminal: FakeTerminal;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement('div');
    terminal = {
      rows: 24,
      scrollLines: vi.fn(),
    };
    document.body.appendChild(element);
    Object.defineProperty(navigator, 'vibrate', {
      value: vi.fn(),
      configurable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('应在单指长按 500ms 后显示菜单并触发振动', () => {
    const { attach, detach, isContextMenuVisible, contextMenuPosition } = useTouchGestures({
      terminalRef: ref(element),
      terminal: ref(terminal),
    });

    attach();
    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 120, clientY: 240 }]));
    vi.advanceTimersByTime(500);

    expect(isContextMenuVisible.value).toBe(true);
    expect(contextMenuPosition.value).toEqual({ x: 120, y: 240 });
    expect(navigator.vibrate).toHaveBeenCalledWith(35);
    detach();
  });

  it('应按每 30px 滑动滚动三分之一终端行数', () => {
    const { attach, detach } = useTouchGestures({
      terminalRef: ref(element),
      terminal: ref(terminal),
    });

    attach();
    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 20, clientY: 120 }]));
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 20, clientY: 90 }]));
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 20, clientY: 60 }]));

    expect(terminal.scrollLines).toHaveBeenNthCalledWith(1, 8);
    expect(terminal.scrollLines).toHaveBeenNthCalledWith(2, 8);
    detach();
  });

  it('应忽略多指触摸并交给终端双指缩放处理', () => {
    const { attach, detach, isContextMenuVisible } = useTouchGestures({
      terminalRef: ref(element),
      terminal: ref(terminal),
    });

    attach();
    element.dispatchEvent(
      createTouchEvent('touchstart', [
        { clientX: 20, clientY: 120 },
        { clientX: 80, clientY: 120 },
      ]),
    );
    element.dispatchEvent(
      createTouchEvent('touchmove', [
        { clientX: 20, clientY: 80 },
        { clientX: 100, clientY: 120 },
      ]),
    );
    vi.advanceTimersByTime(500);

    expect(isContextMenuVisible.value).toBe(false);
    expect(terminal.scrollLines).not.toHaveBeenCalled();
    detach();
  });
});
