/**
 * 文件管理器列宽调整逻辑
 * 从 FileManager.vue 提取，负责表格列宽的拖拽调整
 */

import { ref, onScopeDispose, type Ref } from 'vue';

export interface ColumnWidths extends Record<string, number> {
  type: number;
  name: number;
  size: number;
  permissions: number;
  modified: number;
}

export interface UseFileManagerColumnResizeOptions {
  /** 列宽配置 */
  colWidths: Ref<ColumnWidths>;
  /** 调整结束后的回调（用于保存设置） */
  onResizeEnd?: () => void;
}

export interface UseFileManagerColumnResizeReturn {
  /** 是否正在调整列宽 */
  isResizing: Ref<boolean>;
  /** 开始列宽调整 */
  startResize: (event: MouseEvent, index: number) => void;
}

export const useFileManagerColumnResize = (
  options: UseFileManagerColumnResizeOptions,
): UseFileManagerColumnResizeReturn => {
  const { colWidths, onResizeEnd } = options;

  const isResizing = ref(false);
  const resizingColumnIndex = ref(-1);
  const startX = ref(0);
  const startWidth = ref(0);

  const getColumnKeyByIndex = (index: number): keyof ColumnWidths | null => {
    const keys = Object.keys(colWidths.value) as Array<keyof ColumnWidths>;
    return keys[index] ?? null;
  };

  const handleResize = (event: MouseEvent) => {
    if (!isResizing.value || resizingColumnIndex.value < 0) return;
    const currentX = event.clientX;
    const diffX = currentX - startX.value;
    const newWidth = Math.max(30, startWidth.value + diffX);
    const colKey = getColumnKeyByIndex(resizingColumnIndex.value);
    if (colKey) {
      colWidths.value[colKey] = newWidth;
    }
  };

  const stopResize = () => {
    if (isResizing.value) {
      isResizing.value = false;
      resizingColumnIndex.value = -1;
      document.removeEventListener('mousemove', handleResize);
      document.removeEventListener('mouseup', stopResize);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      onResizeEnd?.();
    }
  };

  const startResize = (event: MouseEvent, index: number) => {
    event.stopPropagation();
    event.preventDefault();
    isResizing.value = true;
    resizingColumnIndex.value = index;
    startX.value = event.clientX;
    const colKey = getColumnKeyByIndex(index);
    if (colKey) {
      startWidth.value = colWidths.value[colKey];
    } else {
      const thElement = (event.target as HTMLElement).closest('th');
      startWidth.value = thElement?.offsetWidth ?? 100;
    }
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  // 组件卸载时清理全局事件监听，防止泄漏
  onScopeDispose(() => {
    if (isResizing.value) {
      stopResize();
    }
  });

  return {
    isResizing,
    startResize,
  };
};
