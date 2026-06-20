/**
 * 文件管理器搜索逻辑
 * 从 FileManager.vue 提取，负责搜索框的激活、取消、聚焦及外部触发器监听
 */

import { ref, computed, nextTick, watch, type Ref, type ComputedRef } from 'vue';
import type { useSessionStore } from '../../stores/session.store';
import type { useFocusSwitcherStore } from '../../stores/focusSwitcher.store';
import { log } from '@/utils/log';

type SessionStore = ReturnType<typeof useSessionStore>;
type FocusSwitcherStore = ReturnType<typeof useFocusSwitcherStore>;

/** 工具栏组件最小接口（仅搜索框引用） */
interface SearchToolbarRef {
  searchInputRef: HTMLInputElement | null;
}

export interface UseFileManagerSearchOptions {
  /** 工具栏组件引用（用于聚焦搜索输入框） */
  toolbarRef: ComputedRef<SearchToolbarRef | null>;
  /** 会话 Store */
  sessionStore: SessionStore;
  /** 会话 ID（响应式，支持同一 FileManager 实例服务不同会话） */
  sessionId: Ref<string> | ComputedRef<string>;
  /** 实例 ID */
  instanceId: string;
  /** 搜索查询字符串（来自排序过滤 composable） */
  searchQuery: Ref<string>;
  /** 焦点切换 Store（用于搜索激活触发器） */
  focusSwitcherStore: FocusSwitcherStore;
}

export function useFileManagerSearch(options: UseFileManagerSearchOptions) {
  const { toolbarRef, sessionStore, sessionId, instanceId, searchQuery, focusSwitcherStore } =
    options;

  const logPrefix = computed(() => `[FileManager ${sessionId.value}-${instanceId}]`);

  const isSearchActive = ref(false);

  /** 激活搜索框 */
  const activateSearch = () => {
    isSearchActive.value = true;
    nextTick(() => {
      toolbarRef.value?.searchInputRef?.focus();
    });
  };

  /** 停用搜索框 */
  const deactivateSearch = () => {
    isSearchActive.value = false;
  };

  /** 取消搜索（清空查询并停用） */
  const cancelSearch = () => {
    searchQuery.value = '';
    isSearchActive.value = false;
  };

  /** 聚焦搜索输入框 */
  const focusSearchInput = (): boolean => {
    if (sessionId.value !== sessionStore.activeSessionId) {
      log.info(`${logPrefix.value} Ignoring focus request for inactive session.`);
      return false;
    }

    if (!isSearchActive.value) {
      activateSearch();
      nextTick(() => {
        if (toolbarRef.value?.searchInputRef) {
          toolbarRef.value.searchInputRef.focus();
          log.info(`${logPrefix.value} Search activated and input focused.`);
        } else {
          log.warn(`${logPrefix.value} Search activated but input ref not found after nextTick.`);
        }
      });
      return true;
    } else if (toolbarRef.value?.searchInputRef) {
      toolbarRef.value.searchInputRef.focus();
      log.info(`${logPrefix.value} Search already active, input focused.`);
      return true;
    }

    log.warn(`${logPrefix.value} Could not focus search input.`);
    return false;
  };

  // 监听焦点切换 Store 的搜索激活触发器
  watch(
    () => focusSwitcherStore.activateFileManagerSearchTrigger,
    (newValue, oldValue) => {
      if (newValue > (oldValue ?? 0) && sessionId.value === sessionStore.activeSessionId) {
        log.info(`${logPrefix.value} Received search activation trigger for active session.`);
        activateSearch();
      }
    },
    { immediate: false },
  );

  return {
    isSearchActive,
    activateSearch,
    deactivateSearch,
    cancelSearch,
    focusSearchInput,
  };
}
