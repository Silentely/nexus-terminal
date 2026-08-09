/**
 * 对话框无障碍 composable
 *
 * 统一 AlertDialog / ConfirmDialog 等模态对话框的无障碍行为：
 * 1. 安全的 aria-labelledby id（避免直接用标题文本作 HTML id）
 * 2. 打开时聚焦对话框内的首个可聚焦元素（默认 OK/Confirm 按钮）
 * 3. 焦点圈闭：Tab 循环停留在对话框内，防止焦点逃逸到背景
 * 4. Escape 关闭时恢复焦点到打开前的元素
 */
import { ref, watch, onBeforeUnmount, nextTick, type Ref } from 'vue';

let dialogIdCounter = 0;

/** 生成稳定的对话框标题 id */
export function useDialogTitleId(prefix = 'dialog-title'): string {
  dialogIdCounter += 1;
  return `${prefix}-${dialogIdCounter}`;
}

/**
 * 管理对话框的焦点行为
 * @param visible 对话框可见性 ref
 * @param getFocusable 获取对话框内首个可聚焦元素（挂载后调用）
 */
export function useDialogFocus(
  visible: Ref<boolean>,
  getFocusable: () => HTMLElement | null,
): { handleKeydown: (event: KeyboardEvent) => void } {
  let previouslyFocused: HTMLElement | null = null;

  const focusDialog = async () => {
    // 等待 teleport 渲染完成；ref 可能需多个 tick 才可用，重试几次
    for (let i = 0; i < 5; i++) {
      await nextTick();
      const target = getFocusable() || document.querySelector<HTMLElement>('.dialog-focus-target');
      if (target) {
        target.focus();
        return;
      }
    }
  };

  /** 焦点圈闭：Tab 在对话框内循环 */
  const handleKeydown = (event: KeyboardEvent) => {
    if (!visible.value || event.key !== 'Tab') return;
    const dialogEl = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
    if (!dialogEl) return;

    const focusables = dialogEl.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  watch(
    visible,
    (isVisible) => {
      if (isVisible) {
        previouslyFocused = document.activeElement as HTMLElement | null;
        focusDialog();
        document.addEventListener('keydown', handleKeydown);
      } else {
        document.removeEventListener('keydown', handleKeydown);
        // 恢复焦点到打开前的元素
        if (previouslyFocused && document.contains(previouslyFocused)) {
          previouslyFocused.focus();
        }
        previouslyFocused = null;
      }
    },
    { immediate: true },
  );

  onBeforeUnmount(() => {
    document.removeEventListener('keydown', handleKeydown);
  });

  return { handleKeydown };
}
