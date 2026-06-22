/**
 * useTerminalGestures composable
 * 为移动端终端提供触摸手势支持：
 * - 双指缩放：调整终端字号
 * - 长按选择：触发文本选择模式
 */

import { ref, onMounted, onBeforeUnmount, type Ref } from 'vue';

export interface GestureState {
  /** 当前缩放比例 */
  scale: number;
  /** 是否正在缩放 */
  isScaling: boolean;
}

/**
 * 为终端容器添加触摸手势支持
 * @param containerRef - 终端容器元素引用
 * @param onFontSizeChange - 字号变化回调
 * @returns 手势状态
 */
export function useTerminalGestures(
  containerRef: Ref<HTMLElement | null>,
  onFontSizeChange?: (delta: number) => void,
) {
  const scale = ref(1);
  const isScaling = ref(false);

  // 触摸状态
  let initialDistance = 0;
  let initialScale = 1;
  let longPressTimer: ReturnType<typeof setTimeout> | null = null;

  // 配置
  const MIN_SCALE = 0.5;
  const MAX_SCALE = 3;
  const LONG_PRESS_DELAY = 500; // 长按触发时间（毫秒）
  const PINCH_THRESHOLD = 10; // 双指缩放最小距离变化（像素）

  /**
   * 计算两点之间的距离
   */
  function getDistance(touch1: Touch, touch2: Touch): number {
    const dx = touch1.clientX - touch2.clientX;
    const dy = touch1.clientY - touch2.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 处理触摸开始
   */
  function handleTouchStart(event: TouchEvent) {
    if (event.touches.length === 2) {
      // 双指触摸开始
      event.preventDefault();
      initialDistance = getDistance(event.touches[0], event.touches[1]);
      initialScale = scale.value;
      isScaling.value = true;

      // 清除长按计时器
      if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    } else if (event.touches.length === 1) {
      // 单指触摸：启动长按检测
      longPressTimer = setTimeout(() => {
        // 触发振动反馈（如果设备支持）
        if (navigator.vibrate) {
          navigator.vibrate(50);
        }
      }, LONG_PRESS_DELAY);
    }
  }

  /**
   * 处理触摸移动
   */
  function handleTouchMove(event: TouchEvent) {
    if (event.touches.length === 2 && isScaling.value) {
      event.preventDefault();

      const currentDistance = getDistance(event.touches[0], event.touches[1]);
      const distanceDiff = currentDistance - initialDistance;

      // 只有距离变化超过阈值才触发缩放
      if (Math.abs(distanceDiff) > PINCH_THRESHOLD) {
        const newScale = Math.max(
          MIN_SCALE,
          Math.min(MAX_SCALE, initialScale * (currentDistance / initialDistance)),
        );
        const scaleDelta = newScale - scale.value;
        scale.value = newScale;

        // 通知字号变化（每 0.1 级别触发一次）
        if (onFontSizeChange && Math.abs(scaleDelta) > 0.05) {
          onFontSizeChange(scaleDelta > 0 ? 1 : -1);
          // 重置基准距离，实现增量缩放
          initialDistance = currentDistance;
          initialScale = newScale;
        }
      }
    } else if (event.touches.length === 1 && longPressTimer) {
      // 单指移动，取消长按检测
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  /**
   * 处理触摸结束
   */
  function handleTouchEnd(event: TouchEvent) {
    if (event.touches.length < 2) {
      isScaling.value = false;
    }

    // 清除长按计时器
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  /**
   * 重置缩放比例
   */
  function resetScale() {
    scale.value = 1;
  }

  onMounted(() => {
    const container = containerRef.value;
    if (!container) return;

    container.addEventListener('touchstart', handleTouchStart, { passive: false });
    container.addEventListener('touchmove', handleTouchMove, { passive: false });
    container.addEventListener('touchend', handleTouchEnd);
    container.addEventListener('touchcancel', handleTouchEnd);
  });

  onBeforeUnmount(() => {
    const container = containerRef.value;
    if (!container) return;

    container.removeEventListener('touchstart', handleTouchStart);
    container.removeEventListener('touchmove', handleTouchMove);
    container.removeEventListener('touchend', handleTouchEnd);
    container.removeEventListener('touchcancel', handleTouchEnd);

    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  });

  return {
    scale,
    isScaling,
    resetScale,
  };
}
