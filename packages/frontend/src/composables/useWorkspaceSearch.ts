import { ref, type Ref } from 'vue';
import { log } from '@/utils/log';

/**
 * @interface WorkspaceSearchDependencies
 * @description 工作区搜索所需的外部依赖
 */
export interface WorkspaceSearchDependencies {
  activeSession: Ref<{
    terminalManager: {
      searchNext: (term: string, options?: { incremental?: boolean }) => boolean;
      searchPrevious: (term: string, options?: { incremental?: boolean }) => boolean;
      clearTerminalSearch: () => void;
    };
  } | null>;
  isMobile: Ref<boolean>;
}

/**
 * 工作区搜索 composable
 * 从 WorkspaceView.vue 提取的终端搜索逻辑
 */
export function useWorkspaceSearch(deps: WorkspaceSearchDependencies) {
  const { activeSession, isMobile } = deps;

  /** 当前搜索的关键词 */
  const currentSearchTerm = ref('');

  /**
   * 处理搜索开始
   */
  const handleSearch = (term: string) => {
    currentSearchTerm.value = term;
    if (!term) {
      handleCloseSearch();
      return;
    }
    log.info(`[useWorkspaceSearch] Received search event: "${term}"`);
    handleFindNext();
  };

  /**
   * 查找下一个匹配
   */
  const handleFindNext = () => {
    const manager = activeSession.value?.terminalManager;
    if (manager && currentSearchTerm.value) {
      const mode = isMobile.value ? 'Mobile' : 'Desktop';
      log.info(
        `[useWorkspaceSearch ${mode}] Calling findNext for term: "${currentSearchTerm.value}"`,
      );
      const found = manager.searchNext(currentSearchTerm.value, { incremental: true });
      log.info(`[useWorkspaceSearch ${mode}] findNext returned: ${found}`);
      if (!found) {
        log.info(
          `[useWorkspaceSearch ${mode}] findNext: No more results for "${currentSearchTerm.value}"`,
        );
      }
    } else {
      const mode = isMobile.value ? 'Mobile' : 'Desktop';
      log.warn(
        `[useWorkspaceSearch ${mode}] Cannot findNext, no active session manager or search term.`,
      );
    }
  };

  /**
   * 查找上一个匹配
   */
  const handleFindPrevious = () => {
    const manager = activeSession.value?.terminalManager;
    if (manager && currentSearchTerm.value) {
      const mode = isMobile.value ? 'Mobile' : 'Desktop';
      log.info(
        `[useWorkspaceSearch ${mode}] Calling findPrevious for term: "${currentSearchTerm.value}"`,
      );
      const found = manager.searchPrevious(currentSearchTerm.value, { incremental: true });
      log.info(`[useWorkspaceSearch ${mode}] findPrevious returned: ${found}`);
      if (!found) {
        log.info(
          `[useWorkspaceSearch ${mode}] findPrevious: No previous results for "${currentSearchTerm.value}"`,
        );
      }
    } else {
      const mode = isMobile.value ? 'Mobile' : 'Desktop';
      log.warn(
        `[useWorkspaceSearch ${mode}] Cannot findPrevious, no active session manager or search term.`,
      );
    }
  };

  /**
   * 关闭搜索并清除高亮
   */
  const handleCloseSearch = () => {
    log.info(`[useWorkspaceSearch] Received close-search event.`);
    currentSearchTerm.value = '';
    const manager = activeSession.value?.terminalManager;
    const mode = isMobile.value ? 'Mobile' : 'Desktop';
    if (manager) {
      manager.clearTerminalSearch();
      log.info(`[useWorkspaceSearch ${mode}] Search cleared.`);
    } else {
      log.warn(`[useWorkspaceSearch ${mode}] Cannot clear search, no active session manager.`);
    }
  };

  return {
    currentSearchTerm,
    handleSearch,
    handleFindNext,
    handleFindPrevious,
    handleCloseSearch,
  };
}
