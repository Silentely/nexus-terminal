/**
 * useWorkspaceSearch 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref } from 'vue';
import { useWorkspaceSearch } from './useWorkspaceSearch';

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

describe('useWorkspaceSearch', () => {
  const mockSearchNext = vi.fn();
  const mockSearchPrevious = vi.fn();
  const mockClearTerminalSearch = vi.fn();

  const createDeps = (hasSession = true) => ({
    activeSession: ref(
      hasSession
        ? {
            terminalManager: {
              searchNext: mockSearchNext,
              searchPrevious: mockSearchPrevious,
              clearTerminalSearch: mockClearTerminalSearch,
            },
          }
        : null,
    ),
    isMobile: ref(false),
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('handleSearch', () => {
    it('应设置搜索关键词并调用 findNext', () => {
      mockSearchNext.mockReturnValue(true);
      const { handleSearch, currentSearchTerm } = useWorkspaceSearch(createDeps());

      handleSearch('test');

      expect(currentSearchTerm.value).toBe('test');
      expect(mockSearchNext).toHaveBeenCalledWith('test', { incremental: true });
    });

    it('空关键词应清空搜索并关闭', () => {
      const { handleSearch, currentSearchTerm } = useWorkspaceSearch(createDeps());

      handleSearch('');

      expect(currentSearchTerm.value).toBe('');
      expect(mockClearTerminalSearch).toHaveBeenCalled();
    });

    it('无活跃会话时不应崩溃', () => {
      const { handleSearch, currentSearchTerm } = useWorkspaceSearch(createDeps(false));

      expect(() => handleSearch('test')).not.toThrow();
      expect(currentSearchTerm.value).toBe('test');
    });
  });

  describe('handleFindNext', () => {
    it('应调用 terminalManager.searchNext', () => {
      mockSearchNext.mockReturnValue(true);
      const { handleSearch, handleFindNext } = useWorkspaceSearch(createDeps());
      handleSearch('keyword');
      mockSearchNext.mockClear();

      handleFindNext();

      expect(mockSearchNext).toHaveBeenCalledWith('keyword', { incremental: true });
    });

    it('无搜索词时不应调用', () => {
      const { handleFindNext } = useWorkspaceSearch(createDeps());

      handleFindNext();

      expect(mockSearchNext).not.toHaveBeenCalled();
    });

    it('移动端模式应正常工作', () => {
      mockSearchNext.mockReturnValue(true);
      const deps = createDeps();
      deps.isMobile.value = true;
      const { handleSearch, handleFindNext } = useWorkspaceSearch(deps);
      handleSearch('mobile');
      mockSearchNext.mockClear();

      handleFindNext();

      expect(mockSearchNext).toHaveBeenCalled();
    });
  });

  describe('handleFindPrevious', () => {
    it('应调用 terminalManager.searchPrevious', () => {
      mockSearchPrevious.mockReturnValue(true);
      const { handleSearch, handleFindPrevious } = useWorkspaceSearch(createDeps());
      handleSearch('keyword');
      mockSearchPrevious.mockClear();

      handleFindPrevious();

      expect(mockSearchPrevious).toHaveBeenCalledWith('keyword', { incremental: true });
    });

    it('无搜索词时不应调用', () => {
      const { handleFindPrevious } = useWorkspaceSearch(createDeps());

      handleFindPrevious();

      expect(mockSearchPrevious).not.toHaveBeenCalled();
    });
  });

  describe('handleCloseSearch', () => {
    it('应清空关键词并清除搜索高亮', () => {
      const { handleSearch, handleCloseSearch, currentSearchTerm } =
        useWorkspaceSearch(createDeps());
      handleSearch('test');

      handleCloseSearch();

      expect(currentSearchTerm.value).toBe('');
      expect(mockClearTerminalSearch).toHaveBeenCalled();
    });

    it('无活跃会话时不应崩溃', () => {
      const { handleCloseSearch, currentSearchTerm } = useWorkspaceSearch(createDeps(false));

      expect(() => handleCloseSearch()).not.toThrow();
      expect(currentSearchTerm.value).toBe('');
    });
  });

  describe('返回值', () => {
    it('应返回所有预期的属性和方法', () => {
      const result = useWorkspaceSearch(createDeps());

      expect(result).toHaveProperty('currentSearchTerm');
      expect(result).toHaveProperty('handleSearch');
      expect(result).toHaveProperty('handleFindNext');
      expect(result).toHaveProperty('handleFindPrevious');
      expect(result).toHaveProperty('handleCloseSearch');
    });
  });
});
