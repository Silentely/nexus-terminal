import { getCurrentInstance, onBeforeUnmount, ref, type Ref } from 'vue';
import GuacamoleDefault from 'guacamole-common-js';

export type MouseMappingMode = 'absolute' | 'relative';

export interface TouchMouseMappingOptions {
  guacClient?: Ref<GuacamoleClientLike | null>;
  displayEl?: Ref<HTMLElement | null>;
  client?: Ref<GuacamoleClientLike | null>;
  element?: Ref<HTMLElement | null>;
  Guacamole?: typeof GuacamoleDefault;
  initialMode?: MouseMappingMode;
}

interface MouseStateLike {
  x: number;
  y: number;
  left: boolean;
  middle: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
}

interface GuacamoleClientLike {
  sendMouseState(state: MouseStateLike): void;
}

type GuacamoleRuntime = typeof GuacamoleDefault & {
  Mouse: typeof GuacamoleDefault.Mouse & {
    State?: new (
      x: number,
      y: number,
      left: boolean,
      middle: boolean,
      right: boolean,
      up: boolean,
      down: boolean,
    ) => MouseStateLike;
  };
};

interface TouchPoint {
  x: number;
  y: number;
}

const LONG_PRESS_DELAY = 500;
const MOVE_CANCEL_THRESHOLD = 8;
const RELATIVE_SENSITIVITY = 1.5;

export function useTouchMouseMapping(options: TouchMouseMappingOptions) {
  const mode = ref<MouseMappingMode>(options.initialMode ?? 'absolute');

  let attachedElement: HTMLElement | null = null;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTouch: TouchPoint | null = null;
  let startTouch: TouchPoint | null = null;
  let lastSentPosition: TouchPoint = { x: 0, y: 0 };
  let isAttached = false;
  let longPressTriggered = false;
  let suppressNextClickRelease = false;
  let leftButtonSent = false;

  const getClient = () => options.guacClient?.value ?? options.client?.value ?? null;
  const getElement = () => options.displayEl?.value ?? options.element?.value ?? null;
  const getGuacamole = () => (options.Guacamole ?? GuacamoleDefault) as GuacamoleRuntime;

  const clearLongPressTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  };

  const setMode = (newMode: MouseMappingMode) => {
    mode.value = newMode;
    lastTouch = null;
    // 不重置 lastSentPosition，避免切换到 relative 模式后鼠标跳到左上角
  };

  const createMouseState = (
    x: number,
    y: number,
    buttons: { left?: boolean; middle?: boolean; right?: boolean } = {},
  ): MouseStateLike => {
    const roundedX = Math.round(x);
    const roundedY = Math.round(y);
    const left = Boolean(buttons.left);
    const middle = Boolean(buttons.middle);
    const right = Boolean(buttons.right);
    const StateCtor = getGuacamole().Mouse.State;

    if (StateCtor) {
      return new StateCtor(roundedX, roundedY, left, middle, right, false, false);
    }

    // 类型声明缺少 State 构造函数时，使用 Guacamole 兼容的状态对象。
    return {
      x: roundedX,
      y: roundedY,
      left,
      middle,
      right,
      up: false,
      down: false,
    };
  };

  const sendState = (
    point: TouchPoint,
    buttons: { left?: boolean; middle?: boolean; right?: boolean } = {},
  ) => {
    const client = getClient();
    if (!client) return;

    client.sendMouseState(createMouseState(point.x, point.y, buttons));
    lastSentPosition = point;
  };

  const getAbsolutePoint = (touch: Touch): TouchPoint => {
    const element = getElement();
    const rect = element?.getBoundingClientRect();
    if (!rect) return { x: touch.clientX, y: touch.clientY };

    // 获取 Guacamole 画面缩放比例，将 CSS 像素坐标正确映射到远程桌面实际像素坐标
    const client = getClient();
    const displayGetter = client as unknown as {
      getDisplay?: () => { getScale?: () => number };
    } | null;
    const scale =
      displayGetter && typeof displayGetter.getDisplay === 'function'
        ? (displayGetter.getDisplay().getScale?.() ?? 1)
        : 1;

    return {
      x: Math.min(Math.max((touch.clientX - rect.left) / scale, 0), rect.width / scale),
      y: Math.min(Math.max((touch.clientY - rect.top) / scale, 0), rect.height / scale),
    };
  };

  const getRelativePoint = (touch: Touch): TouchPoint => {
    if (!lastTouch) return lastSentPosition;

    return {
      x: lastSentPosition.x + (touch.clientX - lastTouch.x) * RELATIVE_SENSITIVITY,
      y: lastSentPosition.y + (touch.clientY - lastTouch.y) * RELATIVE_SENSITIVITY,
    };
  };

  const getMappedPoint = (touch: Touch): TouchPoint => {
    if (mode.value === 'relative') {
      return getRelativePoint(touch);
    }
    return getAbsolutePoint(touch);
  };

  const getCenterPoint = (touches: TouchList): TouchPoint => {
    const first = touches[0];
    const second = touches[1] ?? touches[0];
    const centerTouch = {
      clientX: (first.clientX + second.clientX) / 2,
      clientY: (first.clientY + second.clientY) / 2,
    } as Touch;

    return mode.value === 'relative' ? lastSentPosition : getAbsolutePoint(centerTouch);
  };

  /** touchcancel 处理：清除状态并释放已按下的左键，但不合成点击 */
  const handleTouchCancel = (_event: TouchEvent) => {
    clearLongPressTimer();

    // 如果左键已按下，释放它
    if (leftButtonSent) {
      sendState(lastSentPosition, { left: false });
    }

    lastTouch = null;
    startTouch = null;
    suppressNextClickRelease = false;
    longPressTriggered = false;
    leftButtonSent = false;
  };

  /** 获取释放左键时的坐标，避免嵌套三元表达式 */
  const getEndPointForRelease = (touch: Touch | undefined): TouchPoint => {
    if (!touch) return lastSentPosition;
    if (mode.value === 'relative') return lastSentPosition;
    return getAbsolutePoint(touch);
  };

  const sendClick = (point: TouchPoint, button: 'left' | 'right') => {
    sendState(point, { [button]: true });
    sendState(point, { [button]: false });
  };

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length === 2) {
      clearLongPressTimer();
      // 释放第一根手指触发的左键按下状态，防止双指轻点时远端残留悬停的左键
      const point = getCenterPoint(event.touches);
      sendState(point, { left: false });
      lastTouch = null;
      startTouch = null;
      if (event.cancelable) {
        event.preventDefault();
      }
      return;
    }

    if (event.touches.length !== 1) return;

    if (event.cancelable) {
      event.preventDefault();
    }

    const touch = event.touches[0];

    startTouch = { x: touch.clientX, y: touch.clientY };
    lastTouch = { x: touch.clientX, y: touch.clientY };
    longPressTriggered = false;
    suppressNextClickRelease = false;
    leftButtonSent = false;

    // 不立即发送左键按下，避免长按场景触发意外的拖拽/选区。
    // 左键会在 touchmove 超过拖拽阈值时发送（确认为拖拽），或在 touchend 时作为 tap 发送。

    clearLongPressTimer();
    longPressTimer = setTimeout(() => {
      const currentPoint = mode.value === 'relative' ? lastSentPosition : getAbsolutePoint(touch);
      sendClick(currentPoint, 'right');
      longPressTriggered = true;
      suppressNextClickRelease = true;
      longPressTimer = null;
    }, LONG_PRESS_DELAY);
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      clearLongPressTimer();
      return;
    }

    if (event.cancelable) {
      event.preventDefault();
    }

    const touch = event.touches[0];
    const point = getMappedPoint(touch);

    if (
      startTouch &&
      Math.hypot(touch.clientX - startTouch.x, touch.clientY - startTouch.y) > MOVE_CANCEL_THRESHOLD
    ) {
      clearLongPressTimer();
      // 超过拖拽阈值，确认为拖拽：首次发送左键按下
      if (!leftButtonSent && !longPressTriggered) {
        // relative 模式下使用 lastSentPosition，避免从触摸起点映射导致光标跳动
        const startPoint =
          mode.value === 'relative'
            ? lastSentPosition
            : getAbsolutePoint({
                clientX: startTouch.x,
                clientY: startTouch.y,
              } as Touch);
        sendState(startPoint, { left: true });
        leftButtonSent = true;
      }
    }

    if (leftButtonSent && !longPressTriggered) {
      sendState(point, { left: true });
    }
    lastTouch = { x: touch.clientX, y: touch.clientY };
  };

  const handleTouchEnd = (event: TouchEvent) => {
    clearLongPressTimer();

    if (event.changedTouches.length >= 2) {
      sendClick(getCenterPoint(event.changedTouches), 'right');
      lastTouch = null;
      startTouch = null;
      leftButtonSent = false;
      return;
    }

    const touch = event.changedTouches[0];

    if (leftButtonSent && !longPressTriggered) {
      // 拖拽结束：释放左键
      const endPoint = getEndPointForRelease(touch);
      sendState(endPoint, { left: false });
    } else if (!longPressTriggered && !suppressNextClickRelease && touch) {
      // 未拖拽且未长按：作为 tap 发送（按下 + 释放）
      const tapPoint = mode.value === 'relative' ? lastSentPosition : getAbsolutePoint(touch);
      sendClick(tapPoint, 'left');
    }

    lastTouch = null;
    startTouch = null;
    suppressNextClickRelease = false;
    longPressTriggered = false;
    leftButtonSent = false;
  };

  const attach = () => {
    if (isAttached) return;
    const element = getElement();
    if (!element) return;

    attachedElement = element;
    attachedElement.addEventListener('touchstart', handleTouchStart, { passive: false });
    attachedElement.addEventListener('touchmove', handleTouchMove, { passive: false });
    attachedElement.addEventListener('touchend', handleTouchEnd, { passive: false });
    attachedElement.addEventListener('touchcancel', handleTouchCancel, { passive: false });
    isAttached = true;
  };

  const detach = () => {
    clearLongPressTimer();

    if (attachedElement) {
      attachedElement.removeEventListener('touchstart', handleTouchStart);
      attachedElement.removeEventListener('touchmove', handleTouchMove);
      attachedElement.removeEventListener('touchend', handleTouchEnd);
      attachedElement.removeEventListener('touchcancel', handleTouchCancel);
    }

    attachedElement = null;
    lastTouch = null;
    startTouch = null;
    isAttached = false;
    suppressNextClickRelease = false;
    longPressTriggered = false;
  };

  if (getCurrentInstance()) {
    onBeforeUnmount(detach);
  }

  return {
    mode,
    setMode,
    attach,
    detach,
  };
}
