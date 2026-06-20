import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { useTouchMouseMapping } from './useTouchMouseMapping';
import type Guacamole from 'guacamole-common-js';

interface TouchPointInit {
  clientX: number;
  clientY: number;
  identifier?: number;
}

interface SentMouseState {
  x: number;
  y: number;
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

const createTouchEvent = (type: string, points: TouchPointInit[]): TouchEvent => {
  const event = new Event(type, { bubbles: true, cancelable: true }) as TouchEvent;
  const touches = points.map((point: TouchPointInit, index: number) => ({
    identifier: point.identifier ?? index,
    clientX: point.clientX,
    clientY: point.clientY,
  })) as unknown as TouchList;

  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : touches });
  Object.defineProperty(event, 'targetTouches', { value: type === 'touchend' ? [] : touches });
  Object.defineProperty(event, 'changedTouches', { value: touches });

  return event;
};

const createGuacamole = () =>
  ({
    Mouse: {
      State: class {
        x: number;
        y: number;
        left: boolean;
        middle: boolean;
        right: boolean;
        up: boolean;
        down: boolean;

        constructor(
          x: number,
          y: number,
          left: boolean,
          middle: boolean,
          right: boolean,
          up: boolean,
          down: boolean,
        ) {
          this.x = x;
          this.y = y;
          this.left = left;
          this.middle = middle;
          this.right = right;
          this.up = up;
          this.down = down;
        }
      },
    },
  }) as unknown as typeof Guacamole;

describe('useTouchMouseMapping', () => {
  let element: HTMLDivElement;
  let sendMouseState: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    element = document.createElement('div');
    Object.defineProperty(element, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 300, height: 200 }),
      configurable: true,
    });
    sendMouseState = vi.fn();
    document.body.appendChild(element);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('absolute 模式应把触摸位置直接映射为屏幕坐标并发送左键点击', () => {
    const { attach, detach } = useTouchMouseMapping({
      element: ref(element),
      client: ref({ sendMouseState } as unknown as InstanceType<typeof Guacamole.Client>),
      Guacamole: createGuacamole(),
      initialMode: 'absolute',
    });

    attach();
    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 110, clientY: 70 }]));
    element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 110, clientY: 70 }]));

    const states = sendMouseState.mock.calls.map((call) => call[0] as SentMouseState);
    expect(states.at(-2)).toMatchObject({ x: 100, y: 50, left: true });
    expect(states.at(-1)).toMatchObject({ x: 100, y: 50, left: false });
    detach();
  });

  it('relative 模式应按 1.5 倍灵敏度把滑动偏移映射为鼠标移动', () => {
    const { attach, detach, setMode, mode } = useTouchMouseMapping({
      element: ref(element),
      client: ref({ sendMouseState } as unknown as InstanceType<typeof Guacamole.Client>),
      Guacamole: createGuacamole(),
      initialMode: 'absolute',
    });

    setMode('relative');
    attach();
    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 50, clientY: 60 }]));
    element.dispatchEvent(createTouchEvent('touchmove', [{ clientX: 70, clientY: 80 }]));

    const lastState = sendMouseState.mock.calls.at(-1)?.[0] as SentMouseState;
    expect(mode.value).toBe('relative');
    expect(lastState).toMatchObject({ x: 30, y: 30, left: true });
    detach();
  });

  it('单指长按和双指轻点都应发送右键点击', () => {
    const { attach, detach } = useTouchMouseMapping({
      element: ref(element),
      client: ref({ sendMouseState } as unknown as InstanceType<typeof Guacamole.Client>),
      Guacamole: createGuacamole(),
      initialMode: 'absolute',
    });

    attach();
    element.dispatchEvent(createTouchEvent('touchstart', [{ clientX: 110, clientY: 70 }]));
    vi.advanceTimersByTime(500);
    element.dispatchEvent(createTouchEvent('touchend', [{ clientX: 110, clientY: 70 }]));
    element.dispatchEvent(
      createTouchEvent('touchstart', [
        { clientX: 130, clientY: 90 },
        { clientX: 160, clientY: 90 },
      ]),
    );
    element.dispatchEvent(
      createTouchEvent('touchend', [
        { clientX: 130, clientY: 90 },
        { clientX: 160, clientY: 90 },
      ]),
    );

    const rightStates = sendMouseState.mock.calls
      .map((call) => call[0] as SentMouseState)
      .filter((state) => state.right);
    expect(rightStates).toHaveLength(2);
    detach();
  });
});
