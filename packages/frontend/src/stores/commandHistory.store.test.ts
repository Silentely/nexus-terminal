import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockDelete = vi.fn();

vi.mock('../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  },
}));

// Mock errorExtractor
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: (err: unknown, fallback: string) => {
    const apiErr = err as {
      response?: { data?: { error?: string; message?: string } };
      message?: string;
    };
    return (
      apiErr?.response?.data?.error ||
      apiErr?.response?.data?.message ||
      apiErr?.message ||
      fallback
    );
  },
}));

// Mock uiNotifications store
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();

vi.mock('./uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

// 模拟 localStorage（happy-dom 中 Storage.prototype 拦截不可靠，使用全局 mock）
const mockLocalStorage = {
  getItem: vi.fn().mockReturnValue(null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

// 辅助：创建模拟历史记录条目
const createMockEntry = (
  overrides: Partial<{ id: number; command: string; timestamp: number }> = {},
) => ({
  id: overrides.id ?? 1,
  command: overrides.command ?? 'ls -la',
  timestamp: overrides.timestamp ?? Math.floor(Date.now() / 1000),
});

describe('commandHistory.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockLocalStorage.getItem.mockReturnValue(null);
    vi.stubGlobal('localStorage', mockLocalStorage);
  });

  describe('初始状态', () => {
    it('应该有正确的默认初始值', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      expect(store.historyList).toEqual([]);
      expect(store.searchTerm).toBe('');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.selectedIndex).toBe(-1);
    });

    it('filteredHistory 在无搜索词时应返回全部列表', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
      ];

      expect(store.filteredHistory).toHaveLength(2);
    });
  });

  describe('filteredHistory 计算属性', () => {
    it('应该根据搜索词过滤历史记录（不区分大小写）', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'git status' }),
        createMockEntry({ id: 2, command: 'npm install' }),
        createMockEntry({ id: 3, command: 'git push' }),
      ];

      store.searchTerm = 'git';
      expect(store.filteredHistory).toHaveLength(2);
      expect(store.filteredHistory[0].command).toBe('git status');
      expect(store.filteredHistory[1].command).toBe('git push');
    });

    it('搜索词应自动忽略前后空格', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls -la' }),
        createMockEntry({ id: 2, command: 'pwd' }),
      ];

      store.searchTerm = '  ls  ';
      expect(store.filteredHistory).toHaveLength(1);
      expect(store.filteredHistory[0].command).toBe('ls -la');
    });

    it('搜索词无匹配时应返回空数组', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'ls' })];

      store.searchTerm = 'nonexistent';
      expect(store.filteredHistory).toHaveLength(0);
    });

    it('空字符串搜索词应返回全部列表', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
      ];

      store.searchTerm = '';
      expect(store.filteredHistory).toHaveLength(2);
    });

    it('空白搜索词应返回全部列表', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'ls' })];

      store.searchTerm = '   ';
      expect(store.filteredHistory).toHaveLength(1);
    });
  });

  describe('selectNextCommand', () => {
    it('无历史记录时 selectedIndex 应为 -1', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(-1);
    });

    it('应该从 -1 前进到 0', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
      ];
      store.selectedIndex = -1;

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(0);
    });

    it('应该循环回到 0（取模行为）', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
        createMockEntry({ id: 3, command: 'cd' }),
      ];
      store.selectedIndex = 2; // 已在最后一条

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(0); // 循环回第一条
    });

    it('搜索过滤后应基于过滤列表切换', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'git status' }),
        createMockEntry({ id: 2, command: 'npm install' }),
        createMockEntry({ id: 3, command: 'git push' }),
      ];
      store.searchTerm = 'git';
      store.selectedIndex = -1;

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(0);

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(1);

      // 只有 2 条匹配，应该循环回 0
      store.selectNextCommand();
      expect(store.selectedIndex).toBe(0);
    });
  });

  describe('selectPreviousCommand', () => {
    it('无历史记录时 selectedIndex 应为 -1', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(-1);
    });

    it('从 -1 选上一条应该跳到最后一条（循环行为）', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
        createMockEntry({ id: 3, command: 'cd' }),
      ];
      store.selectedIndex = -1;

      store.selectPreviousCommand();
      // 当 selectedIndex 为 -1 时，选中最后一个元素
      expect(store.selectedIndex).toBe(2);
    });

    it('应该从 0 回退到最后一条（循环行为）', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
        createMockEntry({ id: 3, command: 'cd' }),
      ];
      store.selectedIndex = 0;

      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(2); // 循环到最后一条
    });

    it('应该正常向前回退', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
      ];
      store.selectedIndex = 1;

      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(0);
    });
  });

  describe('setSearchTerm', () => {
    it('应该正确设置搜索词', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.setSearchTerm('test');
      expect(store.searchTerm).toBe('test');
    });

    it('设置搜索词时应重置 selectedIndex 为 -1', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.selectedIndex = 2;
      store.setSearchTerm('new term');
      expect(store.selectedIndex).toBe(-1);
    });

    it('支持空字符串搜索词', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.searchTerm = 'old';
      store.setSearchTerm('');
      expect(store.searchTerm).toBe('');
    });
  });

  describe('resetSelection', () => {
    it('应该将 selectedIndex 重置为 -1', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.selectedIndex = 3;
      store.resetSelection();
      expect(store.selectedIndex).toBe(-1);
    });

    it('已经为 -1 时调用不应抛出异常', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.selectedIndex = -1;
      expect(() => store.resetSelection()).not.toThrow();
      expect(store.selectedIndex).toBe(-1);
    });
  });

  describe('fetchHistory', () => {
    it('成功获取数据后应更新 historyList（降序）', async () => {
      const serverData = [
        createMockEntry({ id: 1, command: 'first', timestamp: 1000 }),
        createMockEntry({ id: 2, command: 'second', timestamp: 2000 }),
        createMockEntry({ id: 3, command: 'third', timestamp: 3000 }),
      ];
      mockGet.mockResolvedValue({ data: serverData });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      // 后端返回升序，前端翻转为降序
      expect(store.historyList).toHaveLength(3);
      expect(store.historyList[0].command).toBe('third');
      expect(store.historyList[2].command).toBe('first');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('有缓存时应先加载缓存再请求服务器', async () => {
      const cachedData = [createMockEntry({ id: 1, command: 'cached', timestamp: 1000 })];
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(cachedData));

      const freshData = [
        createMockEntry({ id: 1, command: 'cached', timestamp: 1000 }),
        createMockEntry({ id: 2, command: 'new', timestamp: 2000 }),
      ];
      mockGet.mockResolvedValue({ data: freshData });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      // 缓存先加载
      expect(store.historyList).toHaveLength(2);
      expect(store.error).toBeNull();
    });

    it('缓存解析失败时应移除缓存并继续获取', async () => {
      mockLocalStorage.getItem.mockReturnValue('invalid json');

      const freshData = [createMockEntry({ id: 1, command: 'fresh', timestamp: 1000 })];
      mockGet.mockResolvedValue({ data: freshData });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('commandHistoryCache');
      expect(store.historyList).toHaveLength(1);
      expect(store.isLoading).toBe(false);
    });

    it('请求失败时应设置 error 并显示通知，保留缓存数据', async () => {
      const cachedData = [createMockEntry({ id: 1, command: 'cached', timestamp: 1000 })];
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(cachedData));

      const error = new Error('网络错误');
      mockGet.mockRejectedValue(error);

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      expect(store.error).toBeTruthy();
      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(store.isLoading).toBe(false);
      // 缓存数据应保留
      expect(store.historyList).toHaveLength(1);
    });

    it('服务器数据与缓存相同时不应更新缓存', async () => {
      const data = [createMockEntry({ id: 1, command: 'same', timestamp: 1000 })];
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(data));
      mockGet.mockResolvedValue({ data: [...data].reverse() });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      // setItem 不应被调用（数据相同不更新缓存）
      expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
    });

    it('服务器数据不同时应更新缓存', async () => {
      const oldData = [createMockEntry({ id: 1, command: 'old', timestamp: 1000 })];
      mockLocalStorage.getItem.mockReturnValue(JSON.stringify(oldData));

      const newData = [
        createMockEntry({ id: 1, command: 'old', timestamp: 1000 }),
        createMockEntry({ id: 2, command: 'new', timestamp: 2000 }),
      ];
      mockGet.mockResolvedValue({ data: [...newData].reverse() });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      expect(mockLocalStorage.setItem).toHaveBeenCalledWith(
        'commandHistoryCache',
        expect.any(String),
      );
    });
  });

  describe('addCommand', () => {
    it('成功添加命令后应清除缓存并刷新列表', async () => {
      mockPost.mockResolvedValue({ data: { id: 10 } });
      const freshData = [createMockEntry({ id: 10, command: 'new command', timestamp: 3000 })];
      mockGet.mockResolvedValue({ data: freshData });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.addCommand('new command');

      expect(mockPost).toHaveBeenCalledWith('/command-history', { command: 'new command' });
      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('commandHistoryCache');
    });

    it('空字符串命令不应发送请求', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.addCommand('');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('纯空白命令不应发送请求', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.addCommand('   ');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('Ctrl+C 信号（\\x03）不应添加到历史记录', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.addCommand('\x03');

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('命令应自动去除前后空格', async () => {
      mockPost.mockResolvedValue({ data: { id: 1 } });
      mockGet.mockResolvedValue({ data: [] });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.addCommand('  ls -la  ');

      expect(mockPost).toHaveBeenCalledWith('/command-history', { command: 'ls -la' });
    });

    it('添加失败时应显示错误通知', async () => {
      mockPost.mockRejectedValue(new Error('服务器错误'));

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.addCommand('fail command');

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteCommand', () => {
    it('成功删除后应从本地列表移除并显示成功通知', async () => {
      mockDelete.mockResolvedValue({});

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'keep' }),
        createMockEntry({ id: 2, command: 'delete me' }),
        createMockEntry({ id: 3, command: 'keep too' }),
      ];

      await store.deleteCommand(2);

      expect(mockDelete).toHaveBeenCalledWith('/command-history/2');
      expect(store.historyList).toHaveLength(2);
      expect(store.historyList.find((e) => e.id === 2)).toBeUndefined();
      expect(mockShowSuccess).toHaveBeenCalledWith('历史记录已删除');
    });

    it('删除不存在的 ID 不应修改列表', async () => {
      mockDelete.mockResolvedValue({});

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'only' })];

      await store.deleteCommand(999);

      expect(store.historyList).toHaveLength(1);
      expect(mockShowSuccess).toHaveBeenCalled();
    });

    it('删除失败时应显示错误通知', async () => {
      mockDelete.mockRejectedValue(new Error('删除失败'));

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'test' })];

      await store.deleteCommand(1);

      expect(mockShowError).toHaveBeenCalledTimes(1);
      // 失败时不应移除本地条目
      expect(store.historyList).toHaveLength(1);
    });

    it('删除后应清除缓存', async () => {
      mockDelete.mockResolvedValue({});

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1 })];

      await store.deleteCommand(1);

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('commandHistoryCache');
    });
  });

  describe('clearAllHistory', () => {
    it('成功清空后 historyList 应为空并显示成功通知', async () => {
      mockDelete.mockResolvedValue({});

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [
        createMockEntry({ id: 1, command: 'first' }),
        createMockEntry({ id: 2, command: 'second' }),
      ];

      await store.clearAllHistory();

      expect(mockDelete).toHaveBeenCalledWith('/command-history');
      expect(store.historyList).toEqual([]);
      expect(mockShowSuccess).toHaveBeenCalledWith('所有历史记录已清空');
    });

    it('清空失败时应显示错误通知', async () => {
      mockDelete.mockRejectedValue(new Error('清空失败'));

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'test' })];

      await store.clearAllHistory();

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('清空后应清除缓存', async () => {
      mockDelete.mockResolvedValue({});

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.clearAllHistory();

      expect(mockLocalStorage.removeItem).toHaveBeenCalledWith('commandHistoryCache');
    });

    it('空列表时调用清空不应抛出异常', async () => {
      mockDelete.mockResolvedValue({});

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [];

      await expect(store.clearAllHistory()).resolves.not.toThrow();
    });
  });

  describe('边界条件', () => {
    it('多个 store 实例应共享同一份 state', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store1 = useCommandHistoryStore();
      const store2 = useCommandHistoryStore();

      store1.historyList = [createMockEntry({ id: 1, command: 'shared' })];

      expect(store2.historyList).toHaveLength(1);
      expect(store2.historyList[0].command).toBe('shared');
    });

    it('selectedIndex 在空过滤列表时 selectNextCommand 应保持 -1', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'git status' })];
      store.searchTerm = 'no match';

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(-1);
    });

    it('selectedIndex 在空过滤列表时 selectPreviousCommand 应保持 -1', async () => {
      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.historyList = [createMockEntry({ id: 1, command: 'git status' })];
      store.searchTerm = 'no match';

      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(-1);
    });

    it('fetchHistory 返回空数组时 historyList 应为空', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      expect(store.historyList).toEqual([]);
      expect(store.isLoading).toBe(false);
    });

    it('fetchHistory 应在 finally 中始终将 isLoading 设为 false', async () => {
      mockGet.mockRejectedValue(new Error('fail'));

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      await store.fetchHistory();

      expect(store.isLoading).toBe(false);
    });

    it('fetchHistory 请求成功后应清除之前的 error', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const { useCommandHistoryStore } = await import('./commandHistory.store');
      const store = useCommandHistoryStore();

      store.error = '旧错误';
      await store.fetchHistory();

      expect(store.error).toBeNull();
    });
  });
});
