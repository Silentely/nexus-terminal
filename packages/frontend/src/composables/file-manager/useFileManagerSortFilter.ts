/**
 * 文件管理器排序与过滤逻辑
 * 从 FileManager.vue 提取，负责文件列表的排序和搜索过滤
 */

import { ref, computed, type Ref, type ComputedRef } from 'vue';
import type { FileListItem } from '../../types/sftp.types';

export type SortKey = 'type' | 'filename' | 'size' | 'mtime';
export type SortDirection = 'asc' | 'desc';

export interface UseFileManagerSortFilterOptions {
  /** 原始文件列表（未排序） */
  fileList: Ref<FileListItem[]> | ComputedRef<FileListItem[]>;
}

export interface UseFileManagerSortFilterReturn {
  /** 当前排序字段 */
  sortKey: Ref<SortKey>;
  /** 当前排序方向 */
  sortDirection: Ref<SortDirection>;
  /** 搜索查询字符串 */
  searchQuery: Ref<string>;
  /** 排序后的文件列表 */
  sortedFileList: ComputedRef<FileListItem[]>;
  /** 排序 + 过滤后的文件列表 */
  filteredFileList: ComputedRef<FileListItem[]>;
  /** 处理排序请求 */
  handleSort: (key: string) => void;
}

export const useFileManagerSortFilter = (
  options: UseFileManagerSortFilterOptions,
): UseFileManagerSortFilterReturn => {
  const { fileList } = options;

  const sortKey = ref<SortKey>('filename');
  const sortDirection = ref<SortDirection>('asc');
  const searchQuery = ref('');

  const sortedFileList = computed(() => {
    if (!fileList.value || fileList.value.length === 0) return [];
    const list = [...fileList.value];
    const key = sortKey.value;
    const direction = sortDirection.value === 'asc' ? 1 : -1;

    list.sort((a, b) => {
      if (key !== 'type') {
        if (a.attrs.isDirectory && !b.attrs.isDirectory) return -1;
        if (!a.attrs.isDirectory && b.attrs.isDirectory) return 1;
      }
      let valA: string | number | boolean;
      let valB: string | number | boolean;
      // 文件类型优先级：目录 > 符号链接 > 普通文件
      const typePriority = (item: FileListItem): number => {
        if (item.attrs.isDirectory) return 0;
        if (item.attrs.isSymbolicLink) return 1;
        return 2;
      };
      switch (key) {
        case 'type':
          valA = typePriority(a);
          valB = typePriority(b);
          break;
        case 'filename':
          valA = a.filename.toLowerCase();
          valB = b.filename.toLowerCase();
          break;
        case 'size':
          valA = a.attrs.isFile ? a.attrs.size : -1;
          valB = b.attrs.isFile ? b.attrs.size : -1;
          break;
        case 'mtime':
          valA = a.attrs.mtime;
          valB = b.attrs.mtime;
          break;
        default:
          valA = a.filename.toLowerCase();
          valB = b.filename.toLowerCase();
      }
      if (valA < valB) return -1 * direction;
      if (valA > valB) return 1 * direction;
      // 文件名 tie-break 始终使用升序，与排序方向无关，保证同值分组内顺序稳定
      if (key !== 'filename') return a.filename.localeCompare(b.filename);
      return 0;
    });
    return list;
  });

  const filteredFileList = computed(() => {
    if (!searchQuery.value) {
      return sortedFileList.value;
    }
    const lowerCaseQuery = searchQuery.value.toLowerCase();
    return sortedFileList.value.filter((item) =>
      item.filename.toLowerCase().includes(lowerCaseQuery),
    );
  });

  const handleSort = (key: string) => {
    const typedKey = key as SortKey;
    if (sortKey.value === typedKey) {
      sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    } else {
      sortKey.value = typedKey;
      sortDirection.value = 'asc';
    }
  };

  return {
    sortKey,
    sortDirection,
    searchQuery,
    sortedFileList,
    filteredFileList,
    handleSort,
  };
};
