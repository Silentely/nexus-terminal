import { ref, onMounted, onBeforeUnmount } from 'vue';
import { log } from '@/utils/log';

/**
 * 追踪 visualViewport 变化，用于检测移动端软键盘弹出状态
 *
 * 软键盘弹出时 visualViewport.height 会缩小，通过对比 layoutViewport.height
 * 判断键盘是否可见，并计算键盘遮挡高度。
 *
 * 使用 requestAnimationFrame 合并高频事件，避免 iOS Safari 键盘动画期间的布局抖动。
 * 键盘判断阈值为屏幕高度的 15%，适配不同尺寸设备。
 */
export function useVisualViewport() {
  /** 软键盘是否弹出 */
  const isKeyboardOpen = ref(false);
  /** 软键盘遮挡高度（px），即 layoutViewport 与 visualViewport 的差值 */
  const keyboardHeight = ref(0);

  let rafId: number | null = null;

  const update = () => {
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      const vp = window.visualViewport;
      if (!vp) return;
      const layoutHeight = window.innerHeight;
      const diff = layoutHeight - vp.height;
      // 阈值为屏幕高度的 15%，适配不同尺寸设备（避免小屏误判、大屏漏判）
      const threshold = layoutHeight * 0.15;
      isKeyboardOpen.value = diff > threshold;
      keyboardHeight.value = isKeyboardOpen.value ? diff : 0;
    });
  };

  onMounted(() => {
    const vp = window.visualViewport;
    if (!vp) {
      log.debug(
        '[useVisualViewport] window.visualViewport not available, keyboard tracking disabled',
      );
      return;
    }

    vp.addEventListener('resize', update);
    vp.addEventListener('scroll', update);
    update();
  });

  onBeforeUnmount(() => {
    if (rafId !== null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
    const vp = window.visualViewport;
    if (!vp) return;

    vp.removeEventListener('resize', update);
    vp.removeEventListener('scroll', update);
  });

  return { isKeyboardOpen, keyboardHeight };
}
