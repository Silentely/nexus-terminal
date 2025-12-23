import { ref, onMounted, onUnmounted, type Ref, watch } from 'vue'; // +++ Import watch +++

interface UseSidebarResizeOptions {
  sidebarRef: Ref<HTMLElement | null>;
  handleRef: Ref<HTMLElement | null>;
  side: 'left' | 'right';
  minWidth?: number;
  maxWidth?: number;
  onResizeEnd?: (newWidth: number) => void;
}

export function useSidebarResize({
  sidebarRef,
  handleRef,
  side,
  minWidth = 200, // 默认最小宽度
  maxWidth = 800, // 默认最大宽度
  onResizeEnd,
}: UseSidebarResizeOptions) {
  const isDragging = ref(false);
  const startX = ref(0);
  const startWidth = ref(0);

  const handleMouseDown = (event: MouseEvent) => {
    console.log(`[useSidebarResize] handleMouseDown triggered for side: ${side}`, {
      sidebar: sidebarRef.value,
      handle: handleRef.value,
    }); // +++ Add Log +++
    if (!sidebarRef.value || !handleRef.value) {
      console.log('[useSidebarResize] MouseDown ignored: sidebarRef or handleRef is null.');
      return;
    }

    isDragging.value = true;
    startX.value = event.clientX;
    startWidth.value = sidebarRef.value.offsetWidth;
    document.body.style.cursor = 'col-resize'; // 改变鼠标样式
    document.body.style.userSelect = 'none'; // 禁止选择文本

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isDragging.value || !sidebarRef.value) return;

    const currentX = event.clientX;
    const deltaX = currentX - startX.value;
    let newWidth: number;

    if (side === 'left') {
      newWidth = startWidth.value + deltaX;
    } else {
      // side === 'right'
      newWidth = startWidth.value - deltaX;
    }

    // 应用宽度限制
    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));

    sidebarRef.value.style.width = `${newWidth}px`;
  };

  const handleMouseUp = () => {
    if (!isDragging.value) return;

    isDragging.value = false;
    document.body.style.cursor = ''; // 恢复鼠标样式
    document.body.style.userSelect = ''; // 恢复文本选择

    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);

    if (sidebarRef.value && onResizeEnd) {
      onResizeEnd(sidebarRef.value.offsetWidth); // 传递最终宽度
    }
  };

  // 使用 watch 监视 handleRef 的变化
  watch(
    handleRef,
    (newHandle, oldHandle) => {
      // 移除旧句柄上的监听器（如果存在）
      if (oldHandle) {
        oldHandle.removeEventListener('mousedown', handleMouseDown);
      }
      // 在新句柄上添加监听器（如果存在）
      if (newHandle) {
        newHandle.addEventListener('mousedown', handleMouseDown);
      }
    },
    { immediate: true }
  ); // immediate: true 确保初始时也能尝试附加

  onUnmounted(() => {
    // 组件卸载时确保移除监听器
    if (handleRef.value) {
      handleRef.value.removeEventListener('mousedown', handleMouseDown);
    }
    // 清理可能残留的全局监听器
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  });

  // 返回 isDragging 状态，可能用于 UI 反馈
  return { isDragging };
}
