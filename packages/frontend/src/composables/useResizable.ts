import { ref, onMounted, onBeforeUnmount, type Ref, watch } from 'vue';

interface UseResizableOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  edgeThreshold?: number; // 距离边缘多近视为拖拽手柄
  initialWidth?: number | string; // 允许字符串（% / vh / vw）或数字（px）
  initialHeight?: number | string; // 允许字符串（% / vh / vw）或数字（px）
}

type Edge =
  | 'right'
  | 'bottom'
  | 'left'
  | 'top'
  | 'bottom-right'
  | 'bottom-left'
  | 'top-right'
  | 'top-left'
  | null;

export function useResizable(
  elementRef: Ref<HTMLElement | null>,
  options: UseResizableOptions = {},
) {
  const {
    minWidth = 100, // 默认最小宽度
    minHeight = 100, // 默认最小高度
    maxWidth = Infinity,
    maxHeight = Infinity,
    edgeThreshold = 8, // pixels, sensitivity for edge detection
  } = options;

  const width = ref<number | null>(null);
  const height = ref<number | null>(null);
  const isResizing = ref(false);
  const currentEdge = ref<Edge>(null);

  let startX = 0;
  let startY = 0;
  let startWidth = 0;
  let startHeight = 0;

  const getEdge = (event: MouseEvent, el: HTMLElement): Edge => {
    if (!(el instanceof HTMLElement)) return null;
    const rect = el.getBoundingClientRect();
    const { clientX, clientY } = event;

    // 优先检测四角
    const onRight = Math.abs(clientX - rect.right) < edgeThreshold;
    const onLeft = Math.abs(clientX - rect.left) < edgeThreshold;
    const onBottom = Math.abs(clientY - rect.bottom) < edgeThreshold;
    const onTop = Math.abs(clientY - rect.top) < edgeThreshold;

    if (onRight && onBottom) return 'bottom-right';
    if (onLeft && onBottom) return 'bottom-left';
    if (onRight && onTop) return 'top-right';
    if (onLeft && onTop) return 'top-left';
    if (onRight) return 'right';
    if (onLeft) return 'left';
    if (onBottom) return 'bottom';
    if (onTop) return 'top';

    return null;
  };

  const updateCursorStyle = (el: HTMLElement, edge: Edge) => {
    if (edge === 'left' || edge === 'right') el.style.cursor = 'ew-resize';
    else if (edge === 'top' || edge === 'bottom') el.style.cursor = 'ns-resize';
    else if (edge === 'top-left' || edge === 'bottom-right') el.style.cursor = 'nwse-resize';
    else if (edge === 'top-right' || edge === 'bottom-left') el.style.cursor = 'nesw-resize';
    else el.style.cursor = 'default';
  };

  const handleMouseDown = (event: MouseEvent) => {
    if (!elementRef.value || !(elementRef.value instanceof HTMLElement)) return;
    const edge = getEdge(event, elementRef.value);

    if (!edge) return;
    event.preventDefault(); // 阻止文本选中等默认行为

    isResizing.value = true;
    currentEdge.value = edge;
    startX = event.clientX;
    startY = event.clientY;

    // 确保宽高 ref 持有当前尺寸
    const rect = elementRef.value.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    width.value = startWidth;
    height.value = startHeight;

    elementRef.value.style.userSelect = 'none'; // 阻止文本选中

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!isResizing.value || !elementRef.value || !currentEdge.value) return;
    event.preventDefault();

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    let newWidth = width.value ?? startWidth;
    let newHeight = height.value ?? startHeight;

    if (currentEdge.value.includes('right')) {
      newWidth = startWidth + deltaX;
    }
    if (currentEdge.value.includes('left')) {
      newWidth = startWidth - deltaX;
    }
    if (currentEdge.value.includes('bottom')) {
      newHeight = startHeight + deltaY;
    }
    if (currentEdge.value.includes('top')) {
      newHeight = startHeight - deltaY;
    }

    // 应用约束
    width.value = Math.max(minWidth, Math.min(maxWidth, newWidth));
    height.value = Math.max(minHeight, Math.min(maxHeight, newHeight));
  };

  const handleMouseUp = () => {
    if (!isResizing.value) return;
    isResizing.value = false;
    if (elementRef.value) {
      elementRef.value.style.userSelect = '';
      updateCursorStyle(elementRef.value, null); // 恢复默认或悬停态光标
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  const handleElementHover = (event: MouseEvent) => {
    if (!elementRef.value || isResizing.value) return;
    const edge = getEdge(event, elementRef.value);
    updateCursorStyle(elementRef.value, edge);
  };

  const handleMouseLeave = () => {
    if (!isResizing.value && elementRef.value) {
      elementRef.value.style.cursor = 'default';
    }
  };

  onMounted(() => {
    if (elementRef.value) {
      const el = elementRef.value;
      // 依据元素当前计算尺寸初始化宽高
      // 确保初始 CSS（如 %、vw、vh 或固定值）被尊重
      const computedStyle = window.getComputedStyle(el);
      const parsedWidth = parseFloat(computedStyle.width);
      const parsedHeight = parseFloat(computedStyle.height);

      // 解析为 NaN 时回退到 minWidth/minHeight，或确保值不小于最小尺寸
      width.value = Number.isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
      height.value = Number.isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);

      el.addEventListener('mousedown', handleMouseDown);
      el.addEventListener('mousemove', handleElementHover); // 用于光标样式切换
      // 鼠标离开元素时重置光标
      el.addEventListener('mouseleave', handleMouseLeave);
    }
  });

  onBeforeUnmount(() => {
    if (elementRef.value) {
      elementRef.value.removeEventListener('mousedown', handleMouseDown);
      elementRef.value.removeEventListener('mousemove', handleElementHover);
      elementRef.value.removeEventListener('mouseleave', handleMouseLeave);
    }
    window.removeEventListener('mousemove', handleMouseMove); // 兜底清理
    window.removeEventListener('mouseup', handleMouseUp); // 兜底清理
  });

  // 监听 elementRef 的外部变化（可能变为 null）
  watch(elementRef, (newEl, oldEl) => {
    if (oldEl) {
      oldEl.removeEventListener('mousedown', handleMouseDown);
      oldEl.removeEventListener('mousemove', handleElementHover);
      oldEl.removeEventListener('mouseleave', handleMouseLeave);
    }
    if (newEl) {
      const computedStyle = window.getComputedStyle(newEl);
      const parsedWidth = parseFloat(computedStyle.width);
      const parsedHeight = parseFloat(computedStyle.height);

      // 解析为 NaN 时回退到 minWidth/minHeight，或确保值不小于最小尺寸
      width.value = Number.isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
      height.value = Number.isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);

      newEl.addEventListener('mousedown', handleMouseDown);
      newEl.addEventListener('mousemove', handleElementHover);
      newEl.addEventListener('mouseleave', handleMouseLeave);
    }
  });

  return {
    width,
    height,
    isResizing,
  };
}
