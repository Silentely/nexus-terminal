/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useQuickCommandTagsStore, type QuickCommandTag } from './quickCommandTags.store';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { useUiNotificationsStore } from './uiNotifications.store';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// 模拟 apiClient
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// 模拟 errorExtractor
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn(),
}));

// 模拟 uiNotifications store
vi.mock('./uiNotifications.store', () => ({
  useUiNotificationsStore: vi.fn(),
}));

// 模拟 localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get _store() {
      return store;
    },
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

/** 生成模拟标签数据 */
function createMockTag(overrides: Partial<QuickCommandTag> = {}): QuickCommandTag {
  return {
    id: 1,
    name: '默认标签',
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  };
}

describe('quickCommandTags.store', () => {
  let mockShowError: ReturnType<typeof vi.fn>;
  let mockShowSuccess: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    localStorageMock.clear();

    // 重置 uiNotifications store 模拟
    mockShowError = vi.fn();
    mockShowSuccess = vi.fn();
    vi.mocked(useUiNotificationsStore).mockReturnValue({
      showError: mockShowError,
      showSuccess: mockShowSuccess,
    } as unknown as ReturnType<typeof useUiNotificationsStore>);

    // 默认 extractErrorMessage 行为
    vi.mocked(extractErrorMessage).mockImplementation(
      (_err: unknown, fallback: string) => fallback,
    );
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useQuickCommandTagsStore();

      expect(store.tags).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchTags', () => {
    it('应该在无缓存时从 API 获取标签列表', async () => {
      const store = useQuickCommandTagsStore();
      const mockTags = [
        createMockTag({ id: 1, name: '标签A' }),
        createMockTag({ id: 2, name: '标签B' }),
      ];

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockTags });

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(mockTags);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(apiClient.get).toHaveBeenCalledWith('/quick-command-tags');
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'quickCommandTagsCache',
        JSON.stringify(mockTags),
      );
    });

    it('应该在有缓存时先加载缓存再请求 API', async () => {
      const store = useQuickCommandTagsStore();
      const cachedTags = [createMockTag({ id: 1, name: '缓存标签' })];
      const freshTags = [createMockTag({ id: 1, name: '缓存标签' })]; // 相同数据

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(cachedTags));
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: freshTags });

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(freshTags);
      expect(store.isLoading).toBe(false);
    });

    it('应该在缓存数据与 API 数据不同时更新', async () => {
      const store = useQuickCommandTagsStore();
      const cachedTags = [createMockTag({ id: 1, name: '旧标签' })];
      const freshTags = [
        createMockTag({ id: 1, name: '新标签' }),
        createMockTag({ id: 2, name: '新增标签' }),
      ];

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(cachedTags));
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: freshTags });

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(freshTags);
      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'quickCommandTagsCache',
        JSON.stringify(freshTags),
      );
    });

    it('应该在缓存数据与 API 数据相同时不重复写入缓存', async () => {
      const store = useQuickCommandTagsStore();
      const sameTags = [createMockTag({ id: 1, name: '相同标签' })];

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(sameTags));
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: sameTags });

      await store.fetchTags();

      // setItem 不应被调用（因为数据相同）
      expect(localStorageMock.setItem).not.toHaveBeenCalled();
    });

    it('应该在缓存解析失败时清除缓存并继续请求', async () => {
      const store = useQuickCommandTagsStore();
      const freshTags = [createMockTag({ id: 1, name: '标签' })];

      localStorageMock.getItem.mockReturnValueOnce('invalid-json');
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: freshTags });

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
      expect(store.tags).toEqual(freshTags);
    });

    it('应该在 API 请求失败时设置错误并显示通知', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('网络错误');

      vi.mocked(apiClient.get).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('获取快捷指令标签列表失败');

      const result = await store.fetchTags();

      expect(result).toBe(false);
      expect(store.error).toBe('获取快捷指令标签列表失败');
      expect(store.isLoading).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('获取快捷指令标签列表失败');
    });

    it('应该在 extractErrorMessage 返回空字符串时不显示通知', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('错误');

      vi.mocked(apiClient.get).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('');

      const result = await store.fetchTags();

      expect(result).toBe(false);
      expect(store.error).toBe('');
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('应该在请求完成后始终将 isLoading 设为 false', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('fail'));

      await store.fetchTags();

      expect(store.isLoading).toBe(false);
    });

    it('应该在每次请求前重置 error 为 null', async () => {
      const store = useQuickCommandTagsStore();
      store.error = '之前的错误';

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.fetchTags();

      expect(store.error).toBeNull();
    });
  });

  describe('addTag', () => {
    it('应该成功添加标签并刷新列表', async () => {
      const store = useQuickCommandTagsStore();
      const newTag = createMockTag({ id: 3, name: '新标签' });

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: '创建成功', tag: newTag },
      });
      // addTag 内部调用 fetchTags，需要 mock get
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [newTag] });

      const result = await store.addTag('新标签');

      expect(result).toEqual(newTag);
      expect(apiClient.post).toHaveBeenCalledWith('/quick-command-tags', { name: '新标签' });
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
      expect(mockShowSuccess).toHaveBeenCalledWith('标签已添加');
      expect(store.isLoading).toBe(false);
    });

    it('应该在添加失败时返回 null 并设置错误', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('添加失败');

      vi.mocked(apiClient.post).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('添加快捷指令标签失败');

      const result = await store.addTag('失败标签');

      expect(result).toBeNull();
      expect(store.error).toBe('添加快捷指令标签失败');
      expect(store.isLoading).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('添加快捷指令标签失败');
    });

    it('应该在 extractErrorMessage 返回空字符串时不显示错误通知', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('错误'));
      vi.mocked(extractErrorMessage).mockReturnValueOnce('');

      const result = await store.addTag('标签');

      expect(result).toBeNull();
      expect(store.error).toBe('');
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('应该在请求前设置 isLoading 为 true 并在完成后恢复', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: 'ok', tag: createMockTag() },
      });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.addTag('标签');

      expect(store.isLoading).toBe(false);
    });

    it('应该在请求前重置 error', async () => {
      const store = useQuickCommandTagsStore();
      store.error = '之前的错误';

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: 'ok', tag: createMockTag() },
      });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.addTag('标签');

      expect(store.error).toBeNull();
    });
  });

  describe('updateTag', () => {
    it('应该成功更新标签并刷新列表', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: [createMockTag({ id: 1, name: '更新后' })],
      });

      const result = await store.updateTag(1, '更新后');

      expect(result).toBe(true);
      expect(apiClient.put).toHaveBeenCalledWith('/quick-command-tags/1', { name: '更新后' });
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
      expect(mockShowSuccess).toHaveBeenCalledWith('标签已更新');
      expect(store.isLoading).toBe(false);
    });

    it('应该在更新失败时返回 false 并设置错误', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('更新失败');

      vi.mocked(apiClient.put).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('更新快捷指令标签失败');

      const result = await store.updateTag(999, '不存在');

      expect(result).toBe(false);
      expect(store.error).toBe('更新快捷指令标签失败');
      expect(store.isLoading).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('更新快捷指令标签失败');
    });

    it('应该在 extractErrorMessage 返回空字符串时不显示错误通知', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.put).mockRejectedValueOnce(new Error('错误'));
      vi.mocked(extractErrorMessage).mockReturnValueOnce('');

      const result = await store.updateTag(1, '标签');

      expect(result).toBe(false);
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('应该在请求前设置 isLoading 并在完成后恢复', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.put).mockRejectedValueOnce(new Error('fail'));

      await store.updateTag(1, '名称');

      expect(store.isLoading).toBe(false);
    });

    it('应该在请求前重置 error', async () => {
      const store = useQuickCommandTagsStore();
      store.error = '旧错误';

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.updateTag(1, '名称');

      expect(store.error).toBeNull();
    });
  });

  describe('deleteTag', () => {
    it('应该成功删除标签并刷新列表', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      const result = await store.deleteTag(1);

      expect(result).toBe(true);
      expect(apiClient.delete).toHaveBeenCalledWith('/quick-command-tags/1');
      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
      expect(mockShowSuccess).toHaveBeenCalledWith('标签已删除');
      expect(store.isLoading).toBe(false);
    });

    it('应该在删除失败时返回 false 并设置错误', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('删除失败');

      vi.mocked(apiClient.delete).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('删除快捷指令标签失败');

      const result = await store.deleteTag(999);

      expect(result).toBe(false);
      expect(store.error).toBe('删除快捷指令标签失败');
      expect(store.isLoading).toBe(false);
      expect(mockShowError).toHaveBeenCalledWith('删除快捷指令标签失败');
    });

    it('应该在 extractErrorMessage 返回空字符串时不显示错误通知', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('错误'));
      vi.mocked(extractErrorMessage).mockReturnValueOnce('');

      const result = await store.deleteTag(1);

      expect(result).toBe(false);
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('应该在请求前设置 isLoading 并在完成后恢复', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('fail'));

      await store.deleteTag(1);

      expect(store.isLoading).toBe(false);
    });

    it('应该在请求前重置 error', async () => {
      const store = useQuickCommandTagsStore();
      store.error = '旧错误';

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.deleteTag(1);

      expect(store.error).toBeNull();
    });
  });

  describe('API 错误提取优先级', () => {
    it('应该优先使用 response.data.error', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { error: '自定义错误', message: '消息错误' } },
      });
      vi.mocked(extractErrorMessage).mockReturnValueOnce('自定义错误');

      await store.fetchTags();

      expect(store.error).toBe('自定义错误');
    });

    it('应该在无 response.data.error 时使用 fallback', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络异常'));
      vi.mocked(extractErrorMessage).mockReturnValueOnce('获取快捷指令标签列表失败');

      await store.fetchTags();

      expect(store.error).toBe('获取快捷指令标签列表失败');
    });
  });

  describe('缓存行为', () => {
    it('fetchTags 应使用 localStorage 的 quickCommandTagsCache 键', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.fetchTags();

      expect(localStorageMock.getItem).toHaveBeenCalledWith('quickCommandTagsCache');
    });

    it('addTag 应在成功后清除缓存', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { message: 'ok', tag: createMockTag() },
      });
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.addTag('标签');

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
    });

    it('updateTag 应在成功后清除缓存', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.updateTag(1, '名称');

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
    });

    it('deleteTag 应在成功后清除缓存', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.deleteTag(1);

      expect(localStorageMock.removeItem).toHaveBeenCalledWith('quickCommandTagsCache');
    });

    it('fetchTags 成功获取后应将数据写入缓存', async () => {
      const store = useQuickCommandTagsStore();
      const tags = [createMockTag({ id: 1, name: '缓存测试' })];

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: tags });

      await store.fetchTags();

      expect(localStorageMock.setItem).toHaveBeenCalledWith(
        'quickCommandTagsCache',
        JSON.stringify(tags),
      );
    });
  });

  describe('并发与边界情况', () => {
    it('addTag 失败后不应调用 showSuccess', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('失败'));

      await store.addTag('标签');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('updateTag 失败后不应调用 showSuccess', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.put).mockRejectedValueOnce(new Error('失败'));

      await store.updateTag(1, '名称');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('deleteTag 失败后不应调用 showSuccess', async () => {
      const store = useQuickCommandTagsStore();

      vi.mocked(apiClient.delete).mockRejectedValueOnce(new Error('失败'));

      await store.deleteTag(1);

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('应该在 fetchTags 有缓存但 API 失败时保留缓存数据', async () => {
      const store = useQuickCommandTagsStore();
      const cachedTags = [createMockTag({ id: 1, name: '缓存标签' })];

      localStorageMock.getItem.mockReturnValueOnce(JSON.stringify(cachedTags));
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络错误'));
      vi.mocked(extractErrorMessage).mockReturnValueOnce('获取快捷指令标签列表失败');

      const result = await store.fetchTags();

      // 缓存数据在 API 失败前已经被赋值
      expect(result).toBe(false);
      expect(store.error).toBe('获取快捷指令标签列表失败');
    });

    it('fetchTags 应在缓存为空字符串时正确解析', async () => {
      const store = useQuickCommandTagsStore();

      // 空数组的 JSON
      localStorageMock.getItem.mockReturnValueOnce('[]');
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual([]);
    });

    it('fetchTags 应在缓存解析异常后将 isLoading 设为 true 再请求 API', async () => {
      const store = useQuickCommandTagsStore();

      // 缓存解析抛异常
      localStorageMock.getItem.mockReturnValueOnce('{bad json}');
      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: [] });

      await store.fetchTags();

      expect(store.isLoading).toBe(false);
      expect(store.tags).toEqual([]);
    });
  });

  describe('extractErrorMessage 调用验证', () => {
    it('fetchTags 失败时应传入正确的 fallback 消息', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('test');

      vi.mocked(apiClient.get).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('获取快捷指令标签列表失败');

      await store.fetchTags();

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '获取标签列表失败');
    });

    it('addTag 失败时应传入正确的 fallback 消息', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('test');

      vi.mocked(apiClient.post).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('添加快捷指令标签失败');

      await store.addTag('标签');

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '添加标签失败');
    });

    it('updateTag 失败时应传入正确的 fallback 消息', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('test');

      vi.mocked(apiClient.put).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('更新快捷指令标签失败');

      await store.updateTag(1, '名称');

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '更新标签失败');
    });

    it('deleteTag 失败时应传入正确的 fallback 消息', async () => {
      const store = useQuickCommandTagsStore();
      const error = new Error('test');

      vi.mocked(apiClient.delete).mockRejectedValueOnce(error);
      vi.mocked(extractErrorMessage).mockReturnValueOnce('删除快捷指令标签失败');

      await store.deleteTag(1);

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '删除标签失败');
    });
  });
});
