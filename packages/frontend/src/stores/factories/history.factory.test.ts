import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createHistoryStore } from './history.factory';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// Mock apiClient - 使用 vi.hoisted 确保在 mock 声明前初始化
const { mockGet, mockPost, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    delete: mockDelete,
  },
}));

// Mock errorExtractor
vi.mock('../../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
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
  }),
}));

// Mock uiNotifications store
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();

vi.mock('../uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
  }),
}));

// Create a test store via the factory (using 'command' as itemLabel)
function makeCommandStore() {
  return createHistoryStore<{ id: number; command: string; timestamp: number }>({
    storeId: 'testCommandHistory',
    apiEndpoint: '/test-command-history',
    itemLabel: 'command',
    addLabel: '命令',
    deleteLabel: '历史记录',
    clearLabel: '所有历史记录',
    cacheKey: 'testCommandHistoryCache',
    reverseOrder: true,
  });
}

// Create a test store via the factory (using 'path' as itemLabel, reverseOrder: false)
function makePathStore() {
  return createHistoryStore<{ id: number; path: string; timestamp: number }>({
    storeId: 'testPathHistory',
    apiEndpoint: '/test-path-history',
    itemLabel: 'path',
    addLabel: '路径',
    deleteLabel: '路径历史记录',
    clearLabel: '所有路径历史记录',
    cacheKey: 'testPathHistoryCache',
    reverseOrder: false,
  });
}

const createMockEntry = (
  overrides: Partial<{ id: number; command: string; timestamp: number }> = {},
) => ({
  id: overrides.id ?? 1,
  command: overrides.command ?? 'ls -la',
  timestamp: overrides.timestamp ?? Math.floor(Date.now() / 1000),
});

describe('createHistoryStore factory', () => {
  let useCommandStore: ReturnType<typeof makeCommandStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    useCommandStore = makeCommandStore();
  });

  // -------------------------
  // Initial State
  // -------------------------
  describe('初始状态', () => {
    it('应该有正确的默认初始值', () => {
      const store = useCommandStore();

      expect(store.historyList).toEqual([]);
      expect(store.searchTerm).toBe('');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.selectedIndex).toBe(-1);
    });

    it('filteredHistory 初始时应返回空数组', () => {
      const store = useCommandStore();
      expect(store.filteredHistory).toEqual([]);
    });
  });

  // -------------------------
  // filteredHistory computed
  // -------------------------
  describe('filteredHistory 计算属性', () => {
    it('无搜索词时应返回全部列表', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1, command: 'ls' }),
        createMockEntry({ id: 2, command: 'pwd' }),
      ];
      store.searchTerm = '';
      expect(store.filteredHistory).toHaveLength(2);
    });

    it('应根据 itemLabel 字段（command）过滤（不区分大小写）', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1, command: 'git status' }),
        createMockEntry({ id: 2, command: 'npm install' }),
        createMockEntry({ id: 3, command: 'GIT push' }),
      ];
      store.searchTerm = 'git';
      const result = store.filteredHistory;
      expect(result).toHaveLength(2);
      expect(result[0].command).toBe('git status');
      expect(result[1].command).toBe('GIT push');
    });

    it('纯空白搜索词应返回全部列表', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'ls' })];
      store.searchTerm = '   ';
      expect(store.filteredHistory).toHaveLength(1);
    });

    it('无匹配时应返回空数组', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'ls' })];
      store.searchTerm = 'zzz';
      expect(store.filteredHistory).toHaveLength(0);
    });

    it('应按 path 字段过滤（使用 path itemLabel 的 store）', () => {
      const usePathStore = makePathStore();
      const store = usePathStore();
      store.historyList = [
        { id: 1, path: '/home/user', timestamp: 1 },
        { id: 2, path: '/var/log', timestamp: 2 },
        { id: 3, path: '/Home/Documents', timestamp: 3 },
      ] as any;
      store.searchTerm = 'home';
      const result = store.filteredHistory;
      expect(result).toHaveLength(2);
    });
  });

  // -------------------------
  // selectNext
  // -------------------------
  describe('selectNext', () => {
    it('空列表时 selectedIndex 应保持 -1', () => {
      const store = useCommandStore();
      store.selectNext();
      expect(store.selectedIndex).toBe(-1);
    });

    it('应从 -1 前进到 0', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1 }), createMockEntry({ id: 2 })];
      store.selectedIndex = -1;
      store.selectNext();
      expect(store.selectedIndex).toBe(0);
    });

    it('应在末尾循环回 0', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1 }),
        createMockEntry({ id: 2 }),
        createMockEntry({ id: 3 }),
      ];
      store.selectedIndex = 2;
      store.selectNext();
      expect(store.selectedIndex).toBe(0);
    });

    it('过滤后应基于过滤列表大小循环', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1, command: 'git status' }),
        createMockEntry({ id: 2, command: 'npm install' }),
        createMockEntry({ id: 3, command: 'git push' }),
      ];
      store.searchTerm = 'git';
      store.selectedIndex = -1;

      store.selectNext();
      expect(store.selectedIndex).toBe(0);
      store.selectNext();
      expect(store.selectedIndex).toBe(1);
      store.selectNext();
      expect(store.selectedIndex).toBe(0); // wraps back
    });

    it('selectNextCommand 别名应与 selectNext 行为一致', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1 }), createMockEntry({ id: 2 })];
      store.selectedIndex = -1;
      store.selectNextCommand();
      expect(store.selectedIndex).toBe(0);
    });
  });

  // -------------------------
  // selectPrevious
  // -------------------------
  describe('selectPrevious', () => {
    it('空列表时 selectedIndex 应保持 -1', () => {
      const store = useCommandStore();
      store.selectPrevious();
      expect(store.selectedIndex).toBe(-1);
    });

    it('从 -1 应跳到最后一个元素', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1 }),
        createMockEntry({ id: 2 }),
        createMockEntry({ id: 3 }),
      ];
      store.selectedIndex = -1;
      store.selectPrevious();
      expect(store.selectedIndex).toBe(2);
    });

    it('从 0 应循环到最后一个元素', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1 }),
        createMockEntry({ id: 2 }),
        createMockEntry({ id: 3 }),
      ];
      store.selectedIndex = 0;
      store.selectPrevious();
      expect(store.selectedIndex).toBe(2);
    });

    it('应正常向前回退', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1 }), createMockEntry({ id: 2 })];
      store.selectedIndex = 1;
      store.selectPrevious();
      expect(store.selectedIndex).toBe(0);
    });

    it('过滤后应基于过滤列表操作', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1, command: 'git status' }),
        createMockEntry({ id: 2, command: 'npm install' }),
        createMockEntry({ id: 3, command: 'git push' }),
      ];
      store.searchTerm = 'git';
      store.selectedIndex = -1;
      store.selectPrevious();
      // filteredHistory has 2 items, -1 should go to last (index 1)
      expect(store.selectedIndex).toBe(1);
    });

    it('selectPreviousCommand 别名应与 selectPrevious 行为一致', () => {
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1 }),
        createMockEntry({ id: 2 }),
        createMockEntry({ id: 3 }),
      ];
      store.selectedIndex = -1;
      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(2);
    });
  });

  // -------------------------
  // resetSelection
  // -------------------------
  describe('resetSelection', () => {
    it('应将 selectedIndex 重置为 -1', () => {
      const store = useCommandStore();
      store.selectedIndex = 3;
      store.resetSelection();
      expect(store.selectedIndex).toBe(-1);
    });

    it('已为 -1 时调用不应抛出异常', () => {
      const store = useCommandStore();
      store.selectedIndex = -1;
      expect(() => store.resetSelection()).not.toThrow();
      expect(store.selectedIndex).toBe(-1);
    });
  });

  // -------------------------
  // setSearchTerm
  // -------------------------
  describe('setSearchTerm', () => {
    it('应正确设置搜索词', () => {
      const store = useCommandStore();
      store.setSearchTerm('git');
      expect(store.searchTerm).toBe('git');
    });

    it('设置搜索词时应重置 selectedIndex 为 -1', () => {
      const store = useCommandStore();
      store.selectedIndex = 2;
      store.setSearchTerm('new');
      expect(store.selectedIndex).toBe(-1);
    });

    it('设置空字符串搜索词应有效', () => {
      const store = useCommandStore();
      store.searchTerm = 'old';
      store.setSearchTerm('');
      expect(store.searchTerm).toBe('');
    });
  });

  // -------------------------
  // fetchHistory
  // -------------------------
  describe('fetchHistory', () => {
    it('成功获取时应更新 historyList（reverseOrder=true 时翻转）', async () => {
      const serverData = [
        createMockEntry({ id: 1, command: 'first', timestamp: 1000 }),
        createMockEntry({ id: 2, command: 'second', timestamp: 2000 }),
        createMockEntry({ id: 3, command: 'third', timestamp: 3000 }),
      ];
      mockGet.mockResolvedValue({ data: serverData });

      const store = useCommandStore();
      await store.fetchHistory();

      // reverseOrder=true means backend data is reversed
      expect(store.historyList).toHaveLength(3);
      expect(store.historyList[0].command).toBe('third');
      expect(store.historyList[2].command).toBe('first');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('reverseOrder=false 时不应翻转数据', async () => {
      const usePathStore = makePathStore();
      const serverData = [
        { id: 1, path: '/first', timestamp: 1000 },
        { id: 2, path: '/second', timestamp: 2000 },
      ];
      mockGet.mockResolvedValue({ data: serverData });

      const store = usePathStore();
      await store.fetchHistory();

      expect(store.historyList[0].path).toBe('/first');
      expect(store.historyList[1].path).toBe('/second');
    });

    it('有缓存时应先从缓存加载', async () => {
      const cachedData = [createMockEntry({ id: 1, command: 'cached', timestamp: 1000 })];
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(cachedData),
      );

      const freshData = [
        createMockEntry({ id: 1, command: 'cached', timestamp: 1000 }),
        createMockEntry({ id: 2, command: 'new', timestamp: 2000 }),
      ];
      mockGet.mockResolvedValue({ data: freshData });

      const store = useCommandStore();
      await store.fetchHistory();

      expect(store.historyList).toHaveLength(2);
      expect(store.error).toBeNull();
    });

    it('缓存解析失败时应移除缓存并继续获取', async () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('invalid json {{{');

      const freshData = [createMockEntry({ id: 1, command: 'fresh', timestamp: 1000 })];
      mockGet.mockResolvedValue({ data: freshData });

      const store = useCommandStore();
      await store.fetchHistory();

      expect(localStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
      expect(store.historyList).toHaveLength(1);
      expect(store.isLoading).toBe(false);
    });

    it('API 请求失败时应设置 error 并显示错误通知', async () => {
      mockGet.mockRejectedValue(new Error('网络错误'));

      const store = useCommandStore();
      await store.fetchHistory();

      expect(store.error).toBeTruthy();
      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(store.isLoading).toBe(false);
    });

    it('数据未变化时不应重新写入缓存', async () => {
      const data = [createMockEntry({ id: 1, command: 'same', timestamp: 1000 })];
      // Cache has the reversed data (since reverseOrder=true)
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(data));
      mockGet.mockResolvedValue({ data: [...data].reverse() });

      const store = useCommandStore();
      await store.fetchHistory();

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('数据变化时应更新缓存', async () => {
      const oldData = [createMockEntry({ id: 1, command: 'old', timestamp: 1000 })];
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(oldData));

      const newData = [
        createMockEntry({ id: 2, command: 'new', timestamp: 2000 }),
        createMockEntry({ id: 1, command: 'old', timestamp: 1000 }),
      ];
      mockGet.mockResolvedValue({ data: [...newData].reverse() }); // server returns ascending

      const store = useCommandStore();
      await store.fetchHistory();

      expect(localStorage.setItem).toHaveBeenCalledWith(
        'testCommandHistoryCache',
        expect.any(String),
      );
    });

    it('成功后应清除之前的 error', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const store = useCommandStore();
      store.error = '旧错误';
      await store.fetchHistory();

      expect(store.error).toBeNull();
    });

    it('应使用正确的 API 端点', async () => {
      mockGet.mockResolvedValue({ data: [] });
      const store = useCommandStore();
      await store.fetchHistory();
      expect(mockGet).toHaveBeenCalledWith('/test-command-history');
    });

    it('isLoading 在失败后应为 false', async () => {
      mockGet.mockRejectedValue(new Error('fail'));
      const store = useCommandStore();
      await store.fetchHistory();
      expect(store.isLoading).toBe(false);
    });
  });

  // -------------------------
  // addItem
  // -------------------------
  describe('addItem', () => {
    it('成功添加后应清除缓存并刷新列表', async () => {
      mockPost.mockResolvedValue({ data: { id: 10 } });
      const freshData = [createMockEntry({ id: 10, command: 'new command', timestamp: 3000 })];
      mockGet.mockResolvedValue({ data: freshData });

      const store = useCommandStore();
      await store.addItem('new command');

      expect(mockPost).toHaveBeenCalledWith('/test-command-history', { command: 'new command' });
      expect(localStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('应使用正确的 itemLabel 键发送请求', async () => {
      const usePathStore = makePathStore();
      mockPost.mockResolvedValue({ data: { id: 1 } });
      mockGet.mockResolvedValue({ data: [] });

      const store = usePathStore();
      await store.addItem('/home/user');

      expect(mockPost).toHaveBeenCalledWith('/test-path-history', { path: '/home/user' });
    });

    it('空字符串不应发送请求', async () => {
      const store = useCommandStore();
      await store.addItem('');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('纯空白字符串不应发送请求', async () => {
      const store = useCommandStore();
      await store.addItem('   ');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('Ctrl+C 信号（\\x03）不应添加到历史', async () => {
      const store = useCommandStore();
      await store.addItem('\x03');
      expect(mockPost).not.toHaveBeenCalled();
    });

    it('命令应自动去除前后空格', async () => {
      mockPost.mockResolvedValue({ data: { id: 1 } });
      mockGet.mockResolvedValue({ data: [] });

      const store = useCommandStore();
      await store.addItem('  ls -la  ');

      expect(mockPost).toHaveBeenCalledWith('/test-command-history', { command: 'ls -la' });
    });

    it('添加失败时应显示错误通知', async () => {
      mockPost.mockRejectedValue(new Error('服务器错误'));

      const store = useCommandStore();
      await store.addItem('fail command');

      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('isLoading 在添加后应为 false', async () => {
      mockPost.mockRejectedValue(new Error('fail'));
      const store = useCommandStore();
      await store.addItem('cmd');
      expect(store.isLoading).toBe(false);
    });

    it('addCommand 别名应与 addItem 行为一致', async () => {
      mockPost.mockResolvedValue({ data: { id: 1 } });
      mockGet.mockResolvedValue({ data: [] });

      const store = useCommandStore();
      await store.addCommand('ls');

      expect(mockPost).toHaveBeenCalledWith('/test-command-history', { command: 'ls' });
    });
  });

  // -------------------------
  // deleteItem
  // -------------------------
  describe('deleteItem', () => {
    it('成功删除后应从本地列表移除并显示成功通知', async () => {
      mockDelete.mockResolvedValue({});

      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1, command: 'keep' }),
        createMockEntry({ id: 2, command: 'delete me' }),
        createMockEntry({ id: 3, command: 'keep too' }),
      ];

      await store.deleteItem(2);

      expect(mockDelete).toHaveBeenCalledWith('/test-command-history/2');
      expect(store.historyList).toHaveLength(2);
      expect(store.historyList.find((e) => e.id === 2)).toBeUndefined();
      expect(mockShowSuccess).toHaveBeenCalledWith('历史记录已删除');
    });

    it('删除不存在的 ID 不应修改列表', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'only' })];
      await store.deleteItem(999);
      expect(store.historyList).toHaveLength(1);
      expect(mockShowSuccess).toHaveBeenCalled();
    });

    it('删除失败时应显示错误通知，不应移除本地条目', async () => {
      mockDelete.mockRejectedValue(new Error('删除失败'));

      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'test' })];
      await store.deleteItem(1);

      expect(mockShowError).toHaveBeenCalledTimes(1);
      expect(store.historyList).toHaveLength(1);
    });

    it('删除后应清除缓存', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1 })];
      await store.deleteItem(1);
      expect(localStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('成功通知使用正确的 deleteLabel', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1 })];
      await store.deleteItem(1);
      expect(mockShowSuccess).toHaveBeenCalledWith('历史记录已删除');
    });

    it('isLoading 在删除后应为 false', async () => {
      mockDelete.mockRejectedValue(new Error('fail'));
      const store = useCommandStore();
      await store.deleteItem(1);
      expect(store.isLoading).toBe(false);
    });

    it('deleteCommand 别名应与 deleteItem 行为一致', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 5, command: 'test' })];
      await store.deleteCommand(5);
      expect(mockDelete).toHaveBeenCalledWith('/test-command-history/5');
      expect(store.historyList).toHaveLength(0);
    });
  });

  // -------------------------
  // clearAll
  // -------------------------
  describe('clearAll', () => {
    it('成功清空后 historyList 应为空并显示成功通知', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [
        createMockEntry({ id: 1, command: 'first' }),
        createMockEntry({ id: 2, command: 'second' }),
      ];

      await store.clearAll();

      expect(mockDelete).toHaveBeenCalledWith('/test-command-history');
      expect(store.historyList).toEqual([]);
      expect(mockShowSuccess).toHaveBeenCalledWith('所有历史记录已清空');
    });

    it('清空失败时应显示错误通知', async () => {
      mockDelete.mockRejectedValue(new Error('清空失败'));
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'test' })];
      await store.clearAll();
      expect(mockShowError).toHaveBeenCalledTimes(1);
    });

    it('清空后应清除缓存', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      await store.clearAll();
      expect(localStorage.removeItem).toHaveBeenCalledWith('testCommandHistoryCache');
    });

    it('空列表时调用清空不应抛出异常', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [];
      await expect(store.clearAll()).resolves.not.toThrow();
    });

    it('clearAllHistory 别名应与 clearAll 行为一致', async () => {
      mockDelete.mockResolvedValue({});
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1 })];
      await store.clearAllHistory();
      expect(store.historyList).toEqual([]);
    });

    it('isLoading 在清空后应为 false', async () => {
      mockDelete.mockRejectedValue(new Error('fail'));
      const store = useCommandStore();
      await store.clearAll();
      expect(store.isLoading).toBe(false);
    });
  });

  // -------------------------
  // Path-specific aliases
  // -------------------------
  describe('addPath / deletePath / selectNextPath / selectPreviousPath 别名', () => {
    it('addPath 别名应与 addItem 行为一致', async () => {
      const usePathStore = makePathStore();
      mockPost.mockResolvedValue({ data: { id: 1 } });
      mockGet.mockResolvedValue({ data: [] });

      const store = usePathStore();
      await store.addPath('/var/log');

      expect(mockPost).toHaveBeenCalledWith('/test-path-history', { path: '/var/log' });
    });

    it('deletePath 别名应与 deleteItem 行为一致', async () => {
      const usePathStore = makePathStore();
      mockDelete.mockResolvedValue({});
      const store = usePathStore();
      store.historyList = [{ id: 3, path: '/tmp', timestamp: 1 }] as any;
      await store.deletePath(3);
      expect(mockDelete).toHaveBeenCalledWith('/test-path-history/3');
    });

    it('selectNextPath 别名应与 selectNext 行为一致', () => {
      const usePathStore = makePathStore();
      const store = usePathStore();
      store.historyList = [
        { id: 1, path: '/a', timestamp: 1 },
        { id: 2, path: '/b', timestamp: 2 },
      ] as any;
      store.selectedIndex = -1;
      store.selectNextPath();
      expect(store.selectedIndex).toBe(0);
    });

    it('selectPreviousPath 别名应与 selectPrevious 行为一致', () => {
      const usePathStore = makePathStore();
      const store = usePathStore();
      store.historyList = [
        { id: 1, path: '/a', timestamp: 1 },
        { id: 2, path: '/b', timestamp: 2 },
        { id: 3, path: '/c', timestamp: 3 },
      ] as any;
      store.selectedIndex = -1;
      store.selectPreviousPath();
      expect(store.selectedIndex).toBe(2);
    });
  });

  // -------------------------
  // Config options
  // -------------------------
  describe('storeId 隔离', () => {
    it('不同 storeId 的 store 应独立维护状态', () => {
      const usePathStore = makePathStore();
      const cmdStore = useCommandStore();
      const pathStore = usePathStore();

      cmdStore.historyList = [createMockEntry({ id: 1, command: 'shared?' })];

      // Path store should be unaffected
      expect(pathStore.historyList).toHaveLength(0);
    });
  });

  // -------------------------
  // Edge cases and boundary conditions
  // -------------------------
  describe('边界条件', () => {
    it('多个 store 实例应共享同一份 state', () => {
      const store1 = useCommandStore();
      const store2 = useCommandStore();

      store1.historyList = [createMockEntry({ id: 1, command: 'shared' })];

      expect(store2.historyList).toHaveLength(1);
      expect(store2.historyList[0].command).toBe('shared');
    });

    it('selectNext 在空过滤列表时应保持 -1', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'git status' })];
      store.searchTerm = 'no match';
      store.selectNext();
      expect(store.selectedIndex).toBe(-1);
    });

    it('selectPrevious 在空过滤列表时应保持 -1', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'git status' })];
      store.searchTerm = 'no match';
      store.selectPrevious();
      expect(store.selectedIndex).toBe(-1);
    });

    it('fetchHistory 返回空数组时 historyList 应为空', async () => {
      mockGet.mockResolvedValue({ data: [] });
      const store = useCommandStore();
      await store.fetchHistory();
      expect(store.historyList).toEqual([]);
      expect(store.isLoading).toBe(false);
    });

    it('error 在 fetchHistory 开始时应重置为 null', async () => {
      mockGet.mockResolvedValue({ data: [] });
      const store = useCommandStore();
      store.error = '旧错误';
      await store.fetchHistory();
      expect(store.error).toBeNull();
    });

    it('selectNext 在单个元素时应循环回自身', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'only' })];
      store.selectedIndex = 0;
      store.selectNext();
      expect(store.selectedIndex).toBe(0);
    });

    it('selectPrevious 在单个元素时应循环回自身', () => {
      const store = useCommandStore();
      store.historyList = [createMockEntry({ id: 1, command: 'only' })];
      store.selectedIndex = 0;
      store.selectPrevious();
      expect(store.selectedIndex).toBe(0);
    });
  });
});
