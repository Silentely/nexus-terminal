import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// Mock apiClient
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
    delete: mockDelete,
  },
}));

// Mock errorExtractor
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
    const apiErr = err as { response?: { data?: { error?: string } }; message?: string };
    return apiErr?.response?.data?.error || apiErr?.message || fallback;
  }),
}));

// Mock cacheManager
const mockCacheManagerRemove = vi.fn();
vi.mock('../utils/cacheManager', () => ({
  cacheManager: {
    remove: mockCacheManagerRemove,
  },
  CACHE_KEYS: {
    TAGS: 'nexus_tags',
    CONNECTIONS: 'nexus_connections',
  },
  CACHE_CONFIG: {},
}));

// 辅助：创建模拟标签数据
const createMockTag = (
  overrides: Partial<{ id: number; name: string; created_at: number; updated_at: number }> = {},
) => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? '测试标签',
  created_at: overrides.created_at ?? Date.now(),
  updated_at: overrides.updated_at ?? Date.now(),
});

// localStorage 存储层
const backingStore: Record<string, string> = {};

/**
 * 配置 localStorage mock 的实现：
 * getItem/setItem/removeItem 都操作 backingStore，
 * 并通过 mockImplementation 让 vitest 能追踪调用。
 */
function setupLocalStorageMock() {
  (localStorage.getItem as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string) => backingStore[key] ?? null,
  );
  (localStorage.setItem as ReturnType<typeof vi.fn>).mockImplementation(
    (key: string, value: string) => {
      backingStore[key] = value;
    },
  );
  (localStorage.removeItem as ReturnType<typeof vi.fn>).mockImplementation((key: string) => {
    delete backingStore[key];
  });
}

describe('tags.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // 清空 backing store 并重新配置 localStorage mock
    Object.keys(backingStore).forEach((k) => delete backingStore[k]);
    setupLocalStorageMock();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', async () => {
      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      expect(store.tags).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchTags', () => {
    it('无缓存时应从 API 获取标签列表并缓存', async () => {
      const mockTags = [
        createMockTag({ id: 1, name: '标签1' }),
        createMockTag({ id: 2, name: '标签2' }),
      ];
      mockGet.mockResolvedValue({ data: mockTags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(mockTags);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockGet).toHaveBeenCalledWith('/tags');
      // fetchTags 成功后应将数据写入缓存
      expect(backingStore['tagsCache']).toBe(JSON.stringify(mockTags));
    });

    it('有缓存时应先显示缓存，再更新为最新数据', async () => {
      const cachedTags = [createMockTag({ id: 1, name: '缓存标签' })];
      backingStore['tagsCache'] = JSON.stringify(cachedTags);

      const freshTags = [
        createMockTag({ id: 1, name: '最新标签' }),
        createMockTag({ id: 2, name: '新标签' }),
      ];
      mockGet.mockResolvedValue({ data: freshTags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(freshTags);
      expect(store.isLoading).toBe(false);
    });

    it('API 返回与缓存相同数据时不更新 localStorage', async () => {
      const tags = [createMockTag({ id: 1, name: '相同标签' })];
      const tagsString = JSON.stringify(tags);
      backingStore['tagsCache'] = tagsString;
      mockGet.mockResolvedValue({ data: tags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(tags);
      // 数据相同时不应再次调用 setItem 写入 tagsCache
      expect(localStorage.setItem).not.toHaveBeenCalledWith('tagsCache', tagsString);
    });

    it('缓存 JSON 解析失败时应清除缓存并从 API 加载', async () => {
      backingStore['tagsCache'] = 'invalid-json{';

      const freshTags = [createMockTag({ id: 1, name: '新标签' })];
      mockGet.mockResolvedValue({ data: freshTags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(freshTags);
      expect(store.error).toBeNull();
      // 解析失败后缓存应被清除
      expect(localStorage.removeItem).toHaveBeenCalledWith('tagsCache');
    });

    it('API 请求失败时应设置错误状态并返回 false', async () => {
      const error = new Error('网络错误');
      mockGet.mockRejectedValue(error);

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.fetchTags();

      expect(result).toBe(false);
      expect(store.error).toBe('网络错误');
      expect(store.isLoading).toBe(false);
    });

    it('API 返回带 response.data.error 的错误时应提取错误消息', async () => {
      const error = { response: { data: { error: '服务器内部错误' } } };
      mockGet.mockRejectedValue(error);

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.fetchTags();

      expect(result).toBe(false);
      expect(store.error).toBe('服务器内部错误');
    });
  });

  describe('addTag', () => {
    it('成功添加标签后应清除缓存并重新获取列表', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });

      const freshTags = [newTag];
      mockGet.mockResolvedValue({ data: freshTags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.addTag('新标签');

      expect(result).toEqual(newTag);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockPost).toHaveBeenCalledWith('/tags', { name: '新标签' });
      expect(localStorage.removeItem).toHaveBeenCalledWith('tagsCache');
      expect(mockGet).toHaveBeenCalledWith('/tags');
    });

    it('添加标签失败时应返回 null 并设置错误状态', async () => {
      const error = new Error('添加失败');
      mockPost.mockRejectedValue(error);

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.addTag('失败标签');

      expect(result).toBeNull();
      expect(store.error).toBe('添加失败');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('updateTag', () => {
    it('成功更新标签后应清除缓存并重新获取列表', async () => {
      mockPut.mockResolvedValue({});

      const updatedTags = [createMockTag({ id: 1, name: '已更新' })];
      mockGet.mockResolvedValue({ data: updatedTags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.updateTag(1, '已更新');

      expect(result).toBe(true);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockPut).toHaveBeenCalledWith('/tags/1', { name: '已更新' });
      expect(localStorage.removeItem).toHaveBeenCalledWith('tagsCache');
    });

    it('更新标签失败时应返回 false 并设置错误状态', async () => {
      const error = { response: { data: { error: '标签不存在' } } };
      mockPut.mockRejectedValue(error);

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.updateTag(999, '不存在');

      expect(result).toBe(false);
      expect(store.error).toBe('标签不存在');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('deleteTag', () => {
    it('成功删除标签后应清除缓存并重新获取列表', async () => {
      mockDelete.mockResolvedValue({});

      const remainingTags = [createMockTag({ id: 2, name: '保留标签' })];
      mockGet.mockResolvedValue({ data: remainingTags });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.deleteTag(1);

      expect(result).toBe(true);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockDelete).toHaveBeenCalledWith('/tags/1');
      expect(localStorage.removeItem).toHaveBeenCalledWith('tagsCache');
    });

    it('删除标签失败时应返回 false 并设置错误状态', async () => {
      const error = new Error('删除失败');
      mockDelete.mockRejectedValue(error);

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const result = await store.deleteTag(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('updateTagConnections', () => {
    it('成功更新标签连接后应清除标签和连接缓存并重新获取', async () => {
      mockPut.mockResolvedValue({});

      const updatedTags = [createMockTag({ id: 1, name: '标签1' })];
      mockGet.mockResolvedValue({ data: updatedTags });

      const { useTagsStoreExtended } = await import('./tags.store');
      const store = useTagsStoreExtended();

      const result = await store.updateTagConnections(1, [10, 20, 30]);

      expect(result).toBe(true);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockPut).toHaveBeenCalledWith('/tags/1/connections', { connection_ids: [10, 20, 30] });
      expect(localStorage.removeItem).toHaveBeenCalledWith('tagsCache');
      expect(localStorage.removeItem).toHaveBeenCalledWith('connections');
    });

    it('空连接 ID 列表时应正确发送请求', async () => {
      mockPut.mockResolvedValue({});

      const updatedTags = [createMockTag({ id: 1, name: '标签1' })];
      mockGet.mockResolvedValue({ data: updatedTags });

      const { useTagsStoreExtended } = await import('./tags.store');
      const store = useTagsStoreExtended();

      const result = await store.updateTagConnections(1, []);

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalledWith('/tags/1/connections', { connection_ids: [] });
    });

    it('更新标签连接失败时应返回 false 并设置错误状态', async () => {
      const error = { response: { data: { error: '连接更新失败' } } };
      mockPut.mockRejectedValue(error);
      mockGet.mockRejectedValue(new Error('fetch also fails'));

      const { useTagsStoreExtended } = await import('./tags.store');
      const store = useTagsStoreExtended();

      const result = await store.updateTagConnections(1, [10]);

      expect(result).toBe(false);
      expect(store.error).toBe('连接更新失败');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('边界条件', () => {
    it('多个 store 实例应共享同一份 state', async () => {
      const mockTags = [createMockTag({ id: 1, name: '共享标签' })];
      mockGet.mockResolvedValue({ data: mockTags });

      const { useTagsStore } = await import('./tags.store');
      const store1 = useTagsStore();
      const store2 = useTagsStore();

      await store1.fetchTags();

      expect(store2.tags).toEqual(mockTags);
      expect(store2.error).toBeNull();
    });

    it('连续调用 fetchTags 不应产生竞态问题', async () => {
      const tags1 = [createMockTag({ id: 1, name: '第一次' })];
      const tags2 = [createMockTag({ id: 1, name: '第二次' })];

      mockGet.mockResolvedValueOnce({ data: tags1 }).mockResolvedValueOnce({ data: tags2 });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      await Promise.all([store.fetchTags(), store.fetchTags()]);

      expect(store.isLoading).toBe(false);
      expect(store.tags.length).toBeGreaterThan(0);
    });

    it('addTag 后 fetchTags 失败时应保留错误状态', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });

      // 第一次 fetchTags（addTag 内部调用）成功
      mockGet.mockResolvedValueOnce({ data: [newTag] });

      const { useTagsStore } = await import('./tags.store');
      const store = useTagsStore();

      const addResult = await store.addTag('新标签');
      expect(addResult).toEqual(newTag);

      // 后续 fetchTags 失败
      mockGet.mockRejectedValueOnce(new Error('后续获取失败'));

      const fetchResult = await store.fetchTags();
      expect(fetchResult).toBe(false);
      expect(store.error).toBe('后续获取失败');
    });

    it('isLoading 在操作完成后应始终为 false', async () => {
      const { useTagsStoreExtended } = await import('./tags.store');
      const store = useTagsStoreExtended();

      // fetchTags 成功
      mockGet.mockResolvedValue({ data: [] });
      await store.fetchTags();
      expect(store.isLoading).toBe(false);

      // fetchTags 失败
      mockGet.mockRejectedValue(new Error('fail'));
      await store.fetchTags();
      expect(store.isLoading).toBe(false);

      // addTag 失败
      mockPost.mockRejectedValue(new Error('fail'));
      await store.addTag('test');
      expect(store.isLoading).toBe(false);

      // updateTag 失败
      mockPut.mockRejectedValue(new Error('fail'));
      await store.updateTag(1, 'test');
      expect(store.isLoading).toBe(false);

      // deleteTag 失败
      mockDelete.mockRejectedValue(new Error('fail'));
      await store.deleteTag(1);
      expect(store.isLoading).toBe(false);

      // updateTagConnections 失败
      mockPut.mockRejectedValue(new Error('fail'));
      await store.updateTagConnections(1, []);
      expect(store.isLoading).toBe(false);
    });
  });
});
