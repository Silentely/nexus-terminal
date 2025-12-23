import { ref, onMounted, onBeforeUnmount, type Ref, watch } from 'vue';

interface UseResizableOptions {
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  edgeThreshold?: number; // How close to an edge to consider it a drag handle
  initialWidth?: number | string; // Allow string for % or vh/vw, or number for px
  initialHeight?: number | string; // Allow string for % or vh/vw, or number for px
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
  options: UseResizableOptions = {}
) {
  const {
    minWidth = 100, // Default min width
    minHeight = 100, // Default min height
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
    const rect = el.getBoundingClientRect();
    const { clientX, clientY } = event;

    // Check corners first
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
    if (!elementRef.value) return;
    const edge = getEdge(event, elementRef.value);

    if (!edge) return;
    event.preventDefault(); // Prevent text selection, etc.

    isResizing.value = true;
    currentEdge.value = edge;
    startX = event.clientX;
    startY = event.clientY;

    // Ensure width and height refs have current dimensions
    const rect = elementRef.value.getBoundingClientRect();
    startWidth = rect.width;
    startHeight = rect.height;
    width.value = startWidth;
    height.value = startHeight;

    elementRef.value.style.userSelect = 'none'; // Prevent text selection

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

    // Apply constraints
    width.value = Math.max(minWidth, Math.min(maxWidth, newWidth));
    height.value = Math.max(minHeight, Math.min(maxHeight, newHeight));
  };

  const handleMouseUp = () => {
    if (!isResizing.value) return;
    isResizing.value = false;
    if (elementRef.value) {
      elementRef.value.style.userSelect = '';
      updateCursorStyle(elementRef.value, null); // Reset to default or hover state
    }
    window.removeEventListener('mousemove', handleMouseMove);
    window.removeEventListener('mouseup', handleMouseUp);
  };

  const handleElementHover = (event: MouseEvent) => {
    if (!elementRef.value || isResizing.value) return;
    const edge = getEdge(event, elementRef.value);
    updateCursorStyle(elementRef.value, edge);
  };

  onMounted(() => {
    if (elementRef.value) {
      const el = elementRef.value;
      // Initialize width and height from element's current computed size
      // This ensures that initial CSS (like %, vw, vh, or fixed values) is respected
      const computedStyle = window.getComputedStyle(el);
      const parsedWidth = parseFloat(computedStyle.width);
      const parsedHeight = parseFloat(computedStyle.height);

      // Fallback to minWidth/minHeight if parsing results in NaN, or ensure value is at least minWidth/minHeight
      width.value = isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
      height.value = isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);

      el.addEventListener('mousedown', handleMouseDown);
      el.addEventListener('mousemove', handleElementHover); // For cursor changes
      // Reset cursor when mouse leaves the element
      el.addEventListener('mouseleave', () => {
        if (!isResizing.value && el) {
          el.style.cursor = 'default';
        }
      });
    }
  });

  onBeforeUnmount(() => {
    if (elementRef.value) {
      elementRef.value.removeEventListener('mousedown', handleMouseDown);
      elementRef.value.removeEventListener('mousemove', handleElementHover);
      elementRef.value.removeEventListener('mouseleave', () => {
        if (elementRef.value) elementRef.value.style.cursor = 'default';
      });
    }
    window.removeEventListener('mousemove', handleMouseMove); // Cleanup just in case
    window.removeEventListener('mouseup', handleMouseUp); // Cleanup just in case
  });

  // Watch for external changes to elementRef if it can become null
  watch(elementRef, (newEl, oldEl) => {
    if (oldEl) {
      oldEl.removeEventListener('mousedown', handleMouseDown);
      oldEl.removeEventListener('mousemove', handleElementHover);
      oldEl.removeEventListener('mouseleave', () => {
        if (oldEl) oldEl.style.cursor = 'default';
      });
    }
    if (newEl) {
      const computedStyle = window.getComputedStyle(newEl);
      const parsedWidth = parseFloat(computedStyle.width);
      const parsedHeight = parseFloat(computedStyle.height);

      // Fallback to minWidth/minHeight if parsing results in NaN, or ensure value is at least minWidth/minHeight
      width.value = isNaN(parsedWidth) ? minWidth : Math.max(minWidth, parsedWidth);
      height.value = isNaN(parsedHeight) ? minHeight : Math.max(minHeight, parsedHeight);

      newEl.addEventListener('mousedown', handleMouseDown);
      newEl.addEventListener('mousemove', handleElementHover);
      newEl.addEventListener('mouseleave', () => {
        if (newEl && !isResizing.value) newEl.style.cursor = 'default';
      });
    }
  });

  return {
    width,
    height,
    isResizing,
  };
}
