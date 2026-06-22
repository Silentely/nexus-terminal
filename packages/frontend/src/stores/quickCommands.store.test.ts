/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref, nextTick } from 'vue';
import type { QuickCommandFE } from './quickCommands.store';

// --- Mock 依赖 ---

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// Mock apiClient
const mockApiGet = vi.fn();
const mockApiPost = vi.fn();
const mockApiPut = vi.fn();
const mockApiDelete = vi.fn();

vi.mock('../utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    post: (...args: unknown[]) => mockApiPost(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
  },
}));

// Mock errorExtractor
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: (err: unknown, fallback: string) => {
    const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
    return apiErr?.response?.data?.error || apiErr?.message || fallback;
  },
}));

// Mock uiNotifications store
const mockShowSuccess = vi.fn();
const mockShowError = vi.fn();

vi.mock('./uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    showSuccess: mockShowSuccess,
    showError: mockShowError,
  }),
}));

// Mock quickCommandTags store — 使用模块级 ref 让测试可操纵标签
const mockTags = ref<{ id: number; name: string }[]>([]);

vi.mock('./quickCommandTags.store', () => ({
  useQuickCommandTagsStore: () => ({
    tags: mockTags.value,
  }),
}));

// --- localStorage mock ---
const localStorageStore: Record<string, string> = {};
const localStorageMock = {
  getItem: vi.fn((key: string) => localStorageStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => {
    localStorageStore[key] = value;
  }),
  removeItem: vi.fn((key: string) => {
    delete localStorageStore[key];
  }),
  clear: vi.fn(() => {
    for (const key of Object.keys(localStorageStore)) {
      delete localStorageStore[key];
    }
  }),
};

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// --- 辅助函数 ---

function createMockCommand(overrides: Partial<QuickCommandFE> = {}): QuickCommandFE {
  return {
    id: overrides.id ?? 1,
    name: overrides.name ?? '测试指令',
    command: overrides.command ?? 'ls -la',
    usage_count: overrides.usage_count ?? 0,
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
    tagIds: overrides.tagIds ?? [],
    variables: overrides.variables,
  };
}

// --- 测试 ---

describe('quickCommands.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorageMock.clear();
    mockTags.value = [];
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // =========================================================================
  // 初始状态
  // =========================================================================
  describe('初始状态', () => {
    it('应该有正确的默认初始状态', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      expect(store.quickCommandsList).toEqual([]);
      expect(store.searchTerm).toBe('');
      expect(store.sortBy).toBe('name');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.selectedIndex).toBe(-1);
      expect(store.expandedGroups).toEqual({});
    });
  });

  // =========================================================================
  // Getter: filteredAndGroupedCommands
  // =========================================================================
  describe('filteredAndGroupedCommands', () => {
    it('无数据时应返回空数组', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      expect(store.filteredAndGroupedCommands).toEqual([]);
    });

    it('无标签的指令应归入"未标记"分组', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'cmd-a', command: 'echo a', tagIds: [] }),
        createMockCommand({ id: 2, name: 'cmd-b', command: 'echo b', tagIds: [] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      expect(groups).toHaveLength(1);
      expect(groups[0].groupName).toBe('未标记');
      expect(groups[0].tagId).toBeNull();
      expect(groups[0].commands).toHaveLength(2);
    });

    it('有标签的指令应按标签名分组', async () => {
      mockTags.value = [{ id: 10, name: '网络' }];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping', command: 'ping 8.8.8.8', tagIds: [10] }),
        createMockCommand({ id: 2, name: 'curl', command: 'curl example.com', tagIds: [10] }),
        createMockCommand({ id: 3, name: 'ls', command: 'ls', tagIds: [] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      const tagGroup = groups.find((g) => g.groupName === '网络');
      const untaggedGroup = groups.find((g) => g.groupName === '未标记');

      expect(tagGroup).toBeDefined();
      expect(tagGroup!.tagId).toBe(10);
      expect(tagGroup!.commands).toHaveLength(2);

      expect(untaggedGroup).toBeDefined();
      expect(untaggedGroup!.commands).toHaveLength(1);
    });

    it('多个不同标签应生成多个分组', async () => {
      mockTags.value = [
        { id: 10, name: '网络' },
        { id: 20, name: '系统' },
      ];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping', tagIds: [10] }),
        createMockCommand({ id: 2, name: 'top', tagIds: [20] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      expect(groups.length).toBeGreaterThanOrEqual(2);
      const groupNames = groups.map((g) => g.groupName);
      expect(groupNames).toContain('网络');
      expect(groupNames).toContain('系统');
    });

    it('分组名应按字母排序', async () => {
      mockTags.value = [
        { id: 30, name: 'AAA' },
        { id: 10, name: 'ZZZ' },
        { id: 20, name: 'MMM' },
      ];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'cmd1', tagIds: [30] }),
        createMockCommand({ id: 2, name: 'cmd2', tagIds: [10] }),
        createMockCommand({ id: 3, name: 'cmd3', tagIds: [20] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      // 除去"未标记"分组后的标签分组
      const tagGroups = groups.filter((g) => g.tagId !== null);
      expect(tagGroups[0].groupName).toBe('AAA');
      expect(tagGroups[1].groupName).toBe('MMM');
      expect(tagGroups[2].groupName).toBe('ZZZ');
    });

    it('同一个指令有多个标签时应出现在多个分组中', async () => {
      mockTags.value = [
        { id: 10, name: '网络' },
        { id: 20, name: '系统' },
      ];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, name: 'multi', tagIds: [10, 20] })];

      const groups = store.filteredAndGroupedCommands;
      const netGroup = groups.find((g) => g.groupName === '网络');
      const sysGroup = groups.find((g) => g.groupName === '系统');

      expect(netGroup!.commands).toHaveLength(1);
      expect(sysGroup!.commands).toHaveLength(1);
    });
  });

  // =========================================================================
  // Getter: filteredAndGroupedCommands 搜索过滤
  // =========================================================================
  describe('搜索过滤', () => {
    it('应按指令名称过滤', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping-test', command: 'ping 8.8.8.8', tagIds: [] }),
        createMockCommand({ id: 2, name: 'curl-api', command: 'curl api', tagIds: [] }),
      ];

      store.setSearchTerm('ping');
      await nextTick();

      const groups = store.filteredAndGroupedCommands;
      const allCmds = groups.flatMap((g) => g.commands);
      expect(allCmds).toHaveLength(1);
      expect(allCmds[0].name).toBe('ping-test');
    });

    it('应按指令内容过滤', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'cmd1', command: 'docker ps', tagIds: [] }),
        createMockCommand({ id: 2, name: 'cmd2', command: 'ls -la', tagIds: [] }),
      ];

      store.setSearchTerm('docker');
      await nextTick();

      const groups = store.filteredAndGroupedCommands;
      const allCmds = groups.flatMap((g) => g.commands);
      expect(allCmds).toHaveLength(1);
      expect(allCmds[0].command).toBe('docker ps');
    });

    it('应按标签名称过滤', async () => {
      mockTags.value = [{ id: 10, name: '网络工具' }];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping', command: 'ping 8.8.8.8', tagIds: [10] }),
        createMockCommand({ id: 2, name: 'ls', command: 'ls', tagIds: [] }),
      ];

      store.setSearchTerm('网络');
      await nextTick();

      const groups = store.filteredAndGroupedCommands;
      const allCmds = groups.flatMap((g) => g.commands);
      expect(allCmds).toHaveLength(1);
      expect(allCmds[0].name).toBe('ping');
    });

    it('搜索应不区分大小写', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'DockerPS', command: 'docker ps', tagIds: [] }),
      ];

      store.setSearchTerm('docker');
      await nextTick();

      const groups = store.filteredAndGroupedCommands;
      const allCmds = groups.flatMap((g) => g.commands);
      expect(allCmds).toHaveLength(1);
    });

    it('无匹配结果时应返回空数组', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping', command: 'ping 8.8.8.8', tagIds: [] }),
      ];

      store.setSearchTerm('不存在的搜索词');
      await nextTick();

      expect(store.filteredAndGroupedCommands).toEqual([]);
    });
  });

  // =========================================================================
  // 排序
  // =========================================================================
  describe('排序', () => {
    it('默认按名称排序', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'zebra', command: 'z', tagIds: [] }),
        createMockCommand({ id: 2, name: 'alpha', command: 'a', tagIds: [] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      expect(groups[0].commands[0].name).toBe('alpha');
      expect(groups[0].commands[1].name).toBe('zebra');
    });

    it('按使用次数排序时应降序排列', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'rare', command: 'a', usage_count: 1, tagIds: [] }),
        createMockCommand({ id: 2, name: 'common', command: 'b', usage_count: 100, tagIds: [] }),
        createMockCommand({ id: 3, name: 'medium', command: 'c', usage_count: 50, tagIds: [] }),
      ];

      store.setSortBy('usage_count');
      await nextTick();

      const groups = store.filteredAndGroupedCommands;
      const cmds = groups[0].commands;
      expect(cmds[0].usage_count).toBe(100);
      expect(cmds[1].usage_count).toBe(50);
      expect(cmds[2].usage_count).toBe(1);
    });

    it('按最近使用排序时应按 updated_at 降序', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'old', command: 'a', updated_at: 1000, tagIds: [] }),
        createMockCommand({ id: 2, name: 'new', command: 'b', updated_at: 9999, tagIds: [] }),
      ];

      store.setSortBy('last_used');
      await nextTick();

      const groups = store.filteredAndGroupedCommands;
      expect(groups[0].commands[0].name).toBe('new');
      expect(groups[0].commands[1].name).toBe('old');
    });

    it('名称为 null 时应使用 command 作为排序依据', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: null, command: 'zebra-cmd', tagIds: [] }),
        createMockCommand({ id: 2, name: 'alpha', command: 'alpha-cmd', tagIds: [] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      expect(groups[0].commands[0].name).toBe('alpha');
      expect(groups[0].commands[1].command).toBe('zebra-cmd');
    });

    it('setSortBy 设置相同值时不应触发重置', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.setSortBy('name');
      store.selectedIndex = 5;
      store.setSortBy('name');

      // 相同值不重置 selectedIndex
      expect(store.selectedIndex).toBe(5);
    });

    it('setSortBy 设置不同值时应重置 selectedIndex', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.selectedIndex = 5;
      store.setSortBy('usage_count');

      expect(store.selectedIndex).toBe(-1);
    });
  });

  // =========================================================================
  // flatVisibleCommands
  // =========================================================================
  describe('flatVisibleCommands', () => {
    it('应返回所有已展开分组中的指令', async () => {
      mockTags.value = [{ id: 10, name: '网络' }];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping', tagIds: [10] }),
        createMockCommand({ id: 2, name: 'ls', tagIds: [] }),
      ];

      // 触发一次计算以初始化 expandedGroups
      const _ = store.filteredAndGroupedCommands;

      // 默认展开
      const flat = store.flatVisibleCommands;
      expect(flat.length).toBe(2);
    });

    it('折叠分组中的指令不应出现在 flatVisibleCommands 中', async () => {
      mockTags.value = [{ id: 10, name: '网络' }];
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'ping', tagIds: [10] }),
        createMockCommand({ id: 2, name: 'ls', tagIds: [] }),
      ];

      // 触发计算以初始化 expandedGroups
      const _ = store.filteredAndGroupedCommands;

      // 折叠"网络"分组
      store.toggleGroup('网络');

      const flat = store.flatVisibleCommands;
      expect(flat).toHaveLength(1);
      expect(flat[0].name).toBe('ls');
    });
  });

  // =========================================================================
  // Actions: toggleGroup
  // =========================================================================
  describe('toggleGroup', () => {
    it('未定义的分组默认设为 false 再取反', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      // toggleGroup 对未定义分组设置 false
      store.toggleGroup('test-group');
      expect(store.expandedGroups['test-group']).toBe(false);
    });

    it('已存在的分组应切换展开状态', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.expandedGroups['my-group'] = true;
      store.toggleGroup('my-group');
      expect(store.expandedGroups['my-group']).toBe(false);

      store.toggleGroup('my-group');
      expect(store.expandedGroups['my-group']).toBe(true);
    });
  });

  // =========================================================================
  // Actions: 键盘导航
  // =========================================================================
  describe('键盘导航', () => {
    it('selectNextCommand 在空列表时应保持 -1', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.selectNextCommand();
      expect(store.selectedIndex).toBe(-1);
    });

    it('selectNextCommand 应循环递增索引', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'a', tagIds: [] }),
        createMockCommand({ id: 2, name: 'b', tagIds: [] }),
        createMockCommand({ id: 3, name: 'c', tagIds: [] }),
      ];

      // 触发 expandedGroups 初始化
      const _ = store.filteredAndGroupedCommands;

      store.selectNextCommand(); // 0
      expect(store.selectedIndex).toBe(0);

      store.selectNextCommand(); // 1
      expect(store.selectedIndex).toBe(1);

      store.selectNextCommand(); // 2
      expect(store.selectedIndex).toBe(2);

      store.selectNextCommand(); // 循环回到 0
      expect(store.selectedIndex).toBe(0);
    });

    it('selectPreviousCommand 在空列表时应保持 -1', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(-1);
    });

    it('selectPreviousCommand 应循环递减索引', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'a', tagIds: [] }),
        createMockCommand({ id: 2, name: 'b', tagIds: [] }),
      ];

      const _ = store.filteredAndGroupedCommands;

      // selectedIndex=-1 时: (-1-1+2)%2 = 0
      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(0);

      // 从 0 循环到最后一项: (0-1+2)%2 = 1
      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(1);

      // 从 1 递减: (1-1+2)%2 = 0
      store.selectPreviousCommand();
      expect(store.selectedIndex).toBe(0);
    });

    it('resetSelection 应重置索引为 -1', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.selectedIndex = 5;
      store.resetSelection();
      expect(store.selectedIndex).toBe(-1);
    });
  });

  // =========================================================================
  // Actions: setSearchTerm
  // =========================================================================
  describe('setSearchTerm', () => {
    it('应更新搜索词并重置 selectedIndex', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.selectedIndex = 3;
      store.setSearchTerm('test');
      expect(store.searchTerm).toBe('test');
      expect(store.selectedIndex).toBe(-1);
    });
  });

  // =========================================================================
  // Actions: loadExpandedGroups
  // =========================================================================
  describe('loadExpandedGroups', () => {
    it('应从 localStorage 加载已保存的展开状态', async () => {
      const savedState = JSON.stringify({ 网络: true, 系统: false });
      localStorageStore['quickCommandsExpandedGroups'] = savedState;

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.loadExpandedGroups();

      expect(store.expandedGroups).toEqual({ 网络: true, 系统: false });
    });

    it('localStorage 无数据时应使用空对象', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.loadExpandedGroups();

      expect(store.expandedGroups).toEqual({});
    });

    it('localStorage 数据为非法 JSON 时应清除并使用空对象', async () => {
      localStorageStore['quickCommandsExpandedGroups'] = '{invalid json';

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.loadExpandedGroups();

      expect(store.expandedGroups).toEqual({});
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandsExpandedGroups');
    });

    it('localStorage 数据非对象类型时应使用空对象', async () => {
      localStorageStore['quickCommandsExpandedGroups'] = '"not an object"';

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.loadExpandedGroups();

      expect(store.expandedGroups).toEqual({});
    });
  });

  // =========================================================================
  // Actions: fetchQuickCommands
  // =========================================================================
  describe('fetchQuickCommands', () => {
    it('应从 API 获取指令列表并更新状态', async () => {
      const apiData = [
        {
          id: 1,
          name: 'cmd1',
          command: 'echo 1',
          usage_count: 5,
          created_at: 1000,
          updated_at: 2000,
          tagIds: [10],
          variables: { host: 'localhost' },
        },
      ];

      // 模拟 localStorage 缓存未命中
      mockApiGet.mockResolvedValue({ data: apiData });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      expect(store.quickCommandsList).toHaveLength(1);
      expect(store.quickCommandsList[0].name).toBe('cmd1');
      expect(store.quickCommandsList[0].tagIds).toEqual([10]);
      expect(store.quickCommandsList[0].variables).toEqual({ host: 'localhost' });
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('API 返回数据缺少 tagIds 时应自动补全为空数组', async () => {
      const apiData = [
        { id: 1, name: 'cmd1', command: 'echo 1', usage_count: 0, created_at: 0, updated_at: 0 },
      ];

      mockApiGet.mockResolvedValue({ data: apiData });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      expect(store.quickCommandsList[0].tagIds).toEqual([]);
      expect(store.quickCommandsList[0].variables).toBeUndefined();
    });

    it('应使用 localStorage 缓存作为初始数据', async () => {
      const cachedData = [
        createMockCommand({ id: 1, name: 'cached', command: 'cached-cmd', tagIds: [] }),
      ];
      localStorageStore['quickCommandsListCache'] = JSON.stringify(cachedData);

      // API 返回相同数据
      mockApiGet.mockResolvedValue({ data: cachedData });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      // 缓存应被加载
      expect(store.quickCommandsList[0].name).toBe('cached');
    });

    it('缓存数据格式无效时应清除缓存', async () => {
      // tagIds 不是数组
      localStorageStore['quickCommandsListCache'] = JSON.stringify([
        {
          id: 1,
          name: 'bad',
          command: 'bad',
          tagIds: 'not-array',
          usage_count: 0,
          created_at: 0,
          updated_at: 0,
        },
      ]);

      mockApiGet.mockResolvedValue({ data: [] });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandsListCache');
    });

    it('API 请求失败时应设置错误消息', async () => {
      const error = new Error('网络错误');
      mockApiGet.mockRejectedValue(error);

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      expect(store.error).toBe('网络错误');
      expect(store.isLoading).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('网络错误');
    });

    it('API 数据与缓存一致时不应更新列表', async () => {
      const data = [createMockCommand({ id: 1, name: 'same', command: 'same', tagIds: [] })];
      // 先设置缓存
      localStorageStore['quickCommandsListCache'] = JSON.stringify(data);
      mockApiGet.mockResolvedValue({ data });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      // 应该不会出错，列表等于 API 返回数据
      expect(store.quickCommandsList).toHaveLength(1);
    });
  });

  // =========================================================================
  // Actions: clearQuickCommandsCache (内部函数，通过 add/delete 间接验证)
  // =========================================================================
  describe('clearQuickCommandsCache (间接)', () => {
    it('addQuickCommand 成功后应清除指令缓存', async () => {
      localStorageStore['quickCommandsListCache'] = '[]';
      mockApiPost.mockResolvedValue({ data: { message: 'ok', command: createMockCommand() } });
      mockApiGet.mockResolvedValue({ data: [] });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.addQuickCommand('test', 'test');

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandsListCache');
    });

    it('deleteQuickCommand 成功后应清除指令缓存', async () => {
      localStorageStore['quickCommandsListCache'] = '[]';
      mockApiDelete.mockResolvedValue({});

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      await store.deleteQuickCommand(1);

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandsListCache');
    });
  });

  // =========================================================================
  // Actions: addQuickCommand
  // =========================================================================
  describe('addQuickCommand', () => {
    it('成功添加指令后应返回 true 并刷新列表', async () => {
      const newCmd = createMockCommand({
        id: 99,
        name: 'new-cmd',
        command: 'echo new',
        tagIds: [10],
      });
      mockApiPost.mockResolvedValue({ data: { message: 'ok', command: newCmd } });
      mockApiGet.mockResolvedValue({ data: [newCmd] });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      const result = await store.addQuickCommand('new-cmd', 'echo new', [10], { var1: 'val1' });

      expect(result).toBe(true);
      expect(mockApiPost).toHaveBeenCalledWith('/quick-commands', {
        name: 'new-cmd',
        command: 'echo new',
        tagIds: [10],
        variables: { var1: 'val1' },
      });
      expect(mockShowSuccess).toHaveBeenCalledWith('快捷指令已添加');
    });

    it('添加失败时应返回 false 并显示错误', async () => {
      mockApiPost.mockRejectedValue(new Error('权限不足'));

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      const result = await store.addQuickCommand('bad-cmd', 'rm -rf /');

      expect(result).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('权限不足');
    });

    it('添加成功后应重新获取指令列表', async () => {
      localStorageStore['quickCommandsListCache'] = '[]';
      mockApiPost.mockResolvedValue({ data: { message: 'ok', command: createMockCommand() } });
      mockApiGet.mockResolvedValue({ data: [] });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.addQuickCommand('test', 'test');

      expect(mockApiGet).toHaveBeenCalledWith('/quick-commands');
    });
  });

  // =========================================================================
  // Actions: updateQuickCommand
  // =========================================================================
  describe('updateQuickCommand', () => {
    it('成功更新指令后应返回 true', async () => {
      const updatedCmd = createMockCommand({ id: 1, name: 'updated', command: 'echo updated' });
      mockApiPut.mockResolvedValue({ data: { message: 'ok', command: updatedCmd } });
      mockApiGet.mockResolvedValue({ data: [updatedCmd] });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      const result = await store.updateQuickCommand(1, 'updated', 'echo updated', [10], { v: '1' });

      expect(result).toBe(true);
      expect(mockApiPut).toHaveBeenCalledWith('/quick-commands/1', {
        name: 'updated',
        command: 'echo updated',
        tagIds: [10],
        variables: { v: '1' },
      });
      expect(mockShowSuccess).toHaveBeenCalledWith('快捷指令已更新');
    });

    it('更新失败时应返回 false 并显示错误', async () => {
      mockApiPut.mockRejectedValue(new Error('指令不存在'));

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      const result = await store.updateQuickCommand(999, 'x', 'x');

      expect(result).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('指令不存在');
    });
  });

  // =========================================================================
  // Actions: deleteQuickCommand
  // =========================================================================
  describe('deleteQuickCommand', () => {
    it('成功删除指令后应从本地列表中移除', async () => {
      mockApiDelete.mockResolvedValue({});

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'to-delete', tagIds: [] }),
        createMockCommand({ id: 2, name: 'to-keep', tagIds: [] }),
      ];

      await store.deleteQuickCommand(1);

      expect(store.quickCommandsList).toHaveLength(1);
      expect(store.quickCommandsList[0].id).toBe(2);
      expect(mockShowSuccess).toHaveBeenCalledWith('快捷指令已删除');
    });

    it('删除不存在的指令不应抛出异常', async () => {
      mockApiDelete.mockResolvedValue({});

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [];

      await expect(store.deleteQuickCommand(999)).resolves.not.toThrow();
    });

    it('删除失败时应显示错误消息', async () => {
      mockApiDelete.mockRejectedValue(new Error('删除失败'));

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      await store.deleteQuickCommand(1);

      expect(store.quickCommandsList).toHaveLength(1); // 本地未移除
      expect(mockShowError).toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Actions: incrementUsage
  // =========================================================================
  describe('incrementUsage', () => {
    it('成功后应增加本地使用次数', async () => {
      mockApiPost.mockResolvedValue({});

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, usage_count: 5, tagIds: [] })];

      await store.incrementUsage(1);

      expect(store.quickCommandsList[0].usage_count).toBe(6);
      expect(mockApiPost).toHaveBeenCalledWith('/quick-commands/1/increment-usage');
    });

    it('当前按使用次数排序时应清除缓存并重新获取', async () => {
      mockApiPost.mockResolvedValue({});
      mockApiGet.mockResolvedValue({ data: [] });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, usage_count: 0, tagIds: [] })];

      store.setSortBy('usage_count');
      await store.incrementUsage(1);

      // 应该调用了 fetchQuickCommands (通过 apiGet)
      expect(mockApiGet).toHaveBeenCalled();
    });

    it('API 失败时不应抛出异常', async () => {
      mockApiPost.mockRejectedValue(new Error('服务器错误'));

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, usage_count: 0, tagIds: [] })];

      await expect(store.incrementUsage(1)).resolves.not.toThrow();
      // 本地使用次数不变
      expect(store.quickCommandsList[0].usage_count).toBe(0);
    });
  });

  // =========================================================================
  // Actions: assignCommandsToTagAction
  // =========================================================================
  describe('assignCommandsToTagAction', () => {
    it('成功分配标签后应更新本地 tagIds', async () => {
      mockApiPost.mockResolvedValue({ data: { success: true } });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: 'cmd1', tagIds: [] }),
        createMockCommand({ id: 2, name: 'cmd2', tagIds: [] }),
      ];

      const result = await store.assignCommandsToTagAction([1, 2], 10);

      expect(result).toBe(true);
      expect(store.quickCommandsList[0].tagIds).toContain(10);
      expect(store.quickCommandsList[1].tagIds).toContain(10);
    });

    it('不应重复添加已存在的标签', async () => {
      mockApiPost.mockResolvedValue({ data: { success: true } });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [10] })];

      await store.assignCommandsToTagAction([1], 10);

      // 不应出现重复
      expect(store.quickCommandsList[0].tagIds.filter((t) => t === 10)).toHaveLength(1);
    });

    it('空命令 ID 列表应返回 false', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      const result = await store.assignCommandsToTagAction([], 10);

      expect(result).toBe(false);
      expect(mockApiPost).not.toHaveBeenCalled();
    });

    it('null 命令 ID 列表应返回 false', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      const result = await store.assignCommandsToTagAction(null as unknown as number[], 10);

      expect(result).toBe(false);
    });

    it('API 返回 success:false 时应返回 false', async () => {
      mockApiPost.mockResolvedValue({ data: { success: false, message: '标签不存在' } });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      const result = await store.assignCommandsToTagAction([1], 999);

      expect(result).toBe(false);
      expect(mockShowError).toHaveBeenCalled();
    });

    it('API 请求失败时应返回 false 并显示错误', async () => {
      mockApiPost.mockRejectedValue(new Error('网络超时'));

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      const result = await store.assignCommandsToTagAction([1], 10);

      expect(result).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('网络超时');
    });

    it('本地列表中不存在的命令 ID 应跳过更新', async () => {
      mockApiPost.mockResolvedValue({ data: { success: true } });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      // 传入不存在的 ID 999
      const result = await store.assignCommandsToTagAction([1, 999], 10);

      expect(result).toBe(true);
      expect(store.quickCommandsList[0].tagIds).toContain(10);
      // 不会抛出异常
    });

    it('tagIds 未初始化时应自动创建数组', async () => {
      mockApiPost.mockResolvedValue({ data: { success: true } });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1 })];
      // 手动将 tagIds 设为 undefined 模拟脏数据
      (store.quickCommandsList[0] as any).tagIds = undefined;

      await store.assignCommandsToTagAction([1], 10);

      expect(store.quickCommandsList[0].tagIds).toContain(10);
    });

    it('操作期间应正确管理 isLoading 状态', async () => {
      let resolvePost: (value: unknown) => void;
      const postPromise = new Promise((resolve) => {
        resolvePost = resolve;
      });
      mockApiPost.mockReturnValue(postPromise);

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      const resultPromise = store.assignCommandsToTagAction([1], 10);
      // 此时应正在加载
      expect(store.isLoading).toBe(true);

      resolvePost!({ data: { success: true } });
      const result = await resultPromise;

      expect(result).toBe(true);
      expect(store.isLoading).toBe(false);
    });
  });

  // =========================================================================
  // 边界条件
  // =========================================================================
  describe('边界条件', () => {
    it('多个 store 实例应共享同一份 state', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store1 = useQuickCommandsStore();
      const store2 = useQuickCommandsStore();

      store1.quickCommandsList = [createMockCommand({ id: 1, tagIds: [] })];

      expect(store2.quickCommandsList).toHaveLength(1);
    });

    it('name 为 null 的指令应按 command 排序', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [
        createMockCommand({ id: 1, name: null, command: 'zzz', tagIds: [] }),
        createMockCommand({ id: 2, name: 'alpha', command: 'aaa', tagIds: [] }),
      ];

      const groups = store.filteredAndGroupedCommands;
      // alpha (name='alpha') 和 zzz (name=null, fallback to command='zzz')
      // 排序后 alpha 在前
      expect(groups[0].commands[0].name).toBe('alpha');
      expect(groups[0].commands[1].command).toBe('zzz');
    });

    it('指令有 variables 属性时应正确处理', async () => {
      const vars = { host: '192.168.1.1', port: '22' };
      mockApiGet.mockResolvedValue({
        data: [createMockCommand({ id: 1, variables: vars, tagIds: [] })],
      });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      expect(store.quickCommandsList[0].variables).toEqual(vars);
    });

    it('variables 非对象时应设为 undefined', async () => {
      mockApiGet.mockResolvedValue({
        data: [createMockCommand({ id: 1, variables: 'bad' as any, tagIds: [] })],
      });

      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      await store.fetchQuickCommands();

      expect(store.quickCommandsList[0].variables).toBeUndefined();
    });

    it('搜索空白字符时应正常过滤', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      store.quickCommandsList = [createMockCommand({ id: 1, name: 'test', tagIds: [] })];

      store.setSearchTerm('   ');
      await nextTick();

      // 空白搜索词 trim 后为空，应返回所有
      expect(store.filteredAndGroupedCommands).toHaveLength(1);
    });

    it('使用大量指令时不应崩溃', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      // 生成 100 条指令
      const cmds = Array.from({ length: 100 }, (_, i) =>
        createMockCommand({ id: i + 1, name: `cmd-${i}`, tagIds: [] }),
      );

      store.quickCommandsList = cmds;

      expect(store.filteredAndGroupedCommands[0].commands).toHaveLength(100);
    });

    it('watcher 应在 expandedGroups 变化时保存到 localStorage', async () => {
      const { useQuickCommandsStore } = await import('./quickCommands.store');
      const store = useQuickCommandsStore();

      // 触发 watcher（通过修改 expandedGroups）
      store.expandedGroups['test'] = true;
      await nextTick();

      // watcher 使用 localStorage.setItem 保存
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'quickCommandsExpandedGroups',
        expect.any(String),
      );
    });
  });
});
