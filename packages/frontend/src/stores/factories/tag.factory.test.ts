import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { createTagStore } from './tag.factory';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// Mock apiClient - 使用 vi.hoisted 确保在 mock 声明前初始化
const { mockGet, mockPost, mockPut, mockDelete } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPost: vi.fn(),
  mockPut: vi.fn(),
  mockDelete: vi.fn(),
}));

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: mockGet,
    post: mockPost,
    put: mockPut,
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

// Factory helpers
function makeDefaultTagStore() {
  return createTagStore({
    storeId: 'testTagStore',
    apiEndpoint: '/test-tags',
    cacheKey: 'testTagsCache',
    useNotifications: true,
  });
}

function makeSilentTagStore() {
  return createTagStore({
    storeId: 'testSilentTagStore',
    apiEndpoint: '/test-silent-tags',
    cacheKey: 'testSilentTagsCache',
    useNotifications: false,
  });
}

const createMockTag = (
  overrides: Partial<{ id: number; name: string; created_at: number; updated_at: number }> = {},
) => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? '测试标签',
  created_at: overrides.created_at ?? Date.now(),
  updated_at: overrides.updated_at ?? Date.now(),
});

describe('createTagStore factory', () => {
  let useTagStore: ReturnType<typeof makeDefaultTagStore>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(null);
    useTagStore = makeDefaultTagStore();
  });

  // -------------------------
  // Initial State
  // -------------------------
  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useTagStore();
      expect(store.tags).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // -------------------------
  // fetchTags
  // -------------------------
  describe('fetchTags', () => {
    it('无缓存时应从 API 获取标签并更新状态', async () => {
      const mockTags = [
        createMockTag({ id: 1, name: '标签A' }),
        createMockTag({ id: 2, name: '标签B' }),
      ];
      mockGet.mockResolvedValue({ data: mockTags });

      const store = useTagStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(mockTags);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(mockGet).toHaveBeenCalledWith('/test-tags');
    });

    it('成功获取后应写入缓存', async () => {
      const mockTags = [createMockTag({ id: 1, name: '缓存测试' })];
      mockGet.mockResolvedValue({ data: mockTags });

      const store = useTagStore();
      await store.fetchTags();

      expect(localStorage.setItem).toHaveBeenCalledWith('testTagsCache', JSON.stringify(mockTags));
    });

    it('有缓存时应先加载缓存再请求 API', async () => {
      const cachedTags = [createMockTag({ id: 1, name: '缓存标签' })];
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(cachedTags),
      );

      const freshTags = [createMockTag({ id: 1, name: '缓存标签' })];
      mockGet.mockResolvedValue({ data: freshTags });

      const store = useTagStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual(freshTags);
      expect(store.isLoading).toBe(false);
    });

    it('API 数据与缓存相同时不应重复写入缓存', async () => {
      const sameTags = [createMockTag({ id: 1, name: '相同标签' })];
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(JSON.stringify(sameTags));
      mockGet.mockResolvedValue({ data: sameTags });

      const store = useTagStore();
      await store.fetchTags();

      expect(localStorage.setItem).not.toHaveBeenCalled();
    });

    it('API 数据变化时应更新缓存', async () => {
      const cachedTags = [createMockTag({ id: 1, name: '旧标签' })];
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue(
        JSON.stringify(cachedTags),
      );

      const freshTags = [
        createMockTag({ id: 1, name: '新标签' }),
        createMockTag({ id: 2, name: '新增标签' }),
      ];
      mockGet.mockResolvedValue({ data: freshTags });

      const store = useTagStore();
      await store.fetchTags();

      expect(localStorage.setItem).toHaveBeenCalledWith('testTagsCache', JSON.stringify(freshTags));
    });

    it('缓存 JSON 解析失败时应清除缓存并从 API 加载', async () => {
      (localStorage.getItem as ReturnType<typeof vi.fn>).mockReturnValue('invalid-json{{{');

      const freshTags = [createMockTag({ id: 1, name: '新标签' })];
      mockGet.mockResolvedValue({ data: freshTags });

      const store = useTagStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.tags).toEqual(freshTags);
    });

    it('API 请求失败时应设置错误状态并返回 false', async () => {
      mockGet.mockRejectedValue(new Error('网络错误'));

      const store = useTagStore();
      const result = await store.fetchTags();

      expect(result).toBe(false);
      expect(store.error).toBe('网络错误');
      expect(store.isLoading).toBe(false);
    });

    it('API 失败时（useNotifications=true）应显示错误通知', async () => {
      mockGet.mockRejectedValue(new Error('网络错误'));

      const store = useTagStore();
      await store.fetchTags();

      expect(mockShowError).toHaveBeenCalledWith('网络错误');
    });

    it('API 失败时（useNotifications=false）不应显示错误通知', async () => {
      mockGet.mockRejectedValue(new Error('网络错误'));
      const useSilentStore = makeSilentTagStore();
      const store = useSilentStore();

      await store.fetchTags();

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('每次请求前应重置 error 为 null', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      store.error = '旧错误';
      await store.fetchTags();

      expect(store.error).toBeNull();
    });

    it('isLoading 在完成后应为 false（失败时）', async () => {
      mockGet.mockRejectedValue(new Error('fail'));

      const store = useTagStore();
      await store.fetchTags();

      expect(store.isLoading).toBe(false);
    });
  });

  // -------------------------
  // addTag
  // -------------------------
  describe('addTag', () => {
    it('成功添加后应返回新标签并刷新列表', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: '创建成功', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useTagStore();
      const result = await store.addTag('新标签');

      expect(result).toEqual(newTag);
      expect(mockPost).toHaveBeenCalledWith('/test-tags', { name: '新标签' });
      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(mockGet).toHaveBeenCalledWith('/test-tags');
    });

    it('成功后（useNotifications=true）应显示成功通知', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useTagStore();
      await store.addTag('新标签');

      expect(mockShowSuccess).toHaveBeenCalledWith('标签已添加');
    });

    it('成功后（useNotifications=false）不应显示成功通知', async () => {
      const useSilentStore = makeSilentTagStore();
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useSilentStore();
      await store.addTag('新标签');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('添加失败时应返回 null 并设置错误', async () => {
      mockPost.mockRejectedValue(new Error('添加失败'));

      const store = useTagStore();
      const result = await store.addTag('失败标签');

      expect(result).toBeNull();
      expect(store.error).toBe('添加失败');
      expect(store.isLoading).toBe(false);
    });

    it('失败时（useNotifications=true）应显示错误通知', async () => {
      mockPost.mockRejectedValue(new Error('添加失败'));

      const store = useTagStore();
      await store.addTag('标签');

      expect(mockShowError).toHaveBeenCalledWith('添加失败');
    });

    it('失败时（useNotifications=false）不应显示错误通知', async () => {
      mockPost.mockRejectedValue(new Error('添加失败'));
      const useSilentStore = makeSilentTagStore();
      const store = useSilentStore();

      await store.addTag('标签');

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('添加前应重置 error 为 null', async () => {
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useTagStore();
      store.error = '旧错误';
      await store.addTag('标签');

      expect(store.error).toBeNull();
    });

    it('isLoading 在添加后应为 false', async () => {
      mockPost.mockRejectedValue(new Error('fail'));

      const store = useTagStore();
      await store.addTag('test');

      expect(store.isLoading).toBe(false);
    });

    it('添加成功后不应显示错误通知', async () => {
      const newTag = createMockTag({ id: 1, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useTagStore();
      await store.addTag('新标签');

      expect(mockShowError).not.toHaveBeenCalled();
    });
  });

  // -------------------------
  // updateTag
  // -------------------------
  describe('updateTag', () => {
    it('成功更新后应返回 true 并刷新列表', async () => {
      mockPut.mockResolvedValue({});
      const updatedTags = [createMockTag({ id: 1, name: '已更新' })];
      mockGet.mockResolvedValue({ data: updatedTags });

      const store = useTagStore();
      const result = await store.updateTag(1, '已更新');

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalledWith('/test-tags/1', { name: '已更新' });
      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('成功后（useNotifications=true）应显示成功通知', async () => {
      mockPut.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [createMockTag({ id: 1, name: '已更新' })] });

      const store = useTagStore();
      await store.updateTag(1, '已更新');

      expect(mockShowSuccess).toHaveBeenCalledWith('标签已更新');
    });

    it('成功后（useNotifications=false）不应显示成功通知', async () => {
      const useSilentStore = makeSilentTagStore();
      mockPut.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useSilentStore();
      await store.updateTag(1, '名称');

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('更新失败时应返回 false 并设置错误', async () => {
      mockPut.mockRejectedValue(new Error('更新失败'));

      const store = useTagStore();
      const result = await store.updateTag(999, '不存在');

      expect(result).toBe(false);
      expect(store.error).toBe('更新失败');
      expect(store.isLoading).toBe(false);
    });

    it('失败时（useNotifications=true）应显示错误通知', async () => {
      mockPut.mockRejectedValue(new Error('更新失败'));

      const store = useTagStore();
      await store.updateTag(1, '标签');

      expect(mockShowError).toHaveBeenCalledWith('更新失败');
    });

    it('失败时（useNotifications=false）不应显示错误通知', async () => {
      const useSilentStore = makeSilentTagStore();
      mockPut.mockRejectedValue(new Error('更新失败'));

      const store = useSilentStore();
      await store.updateTag(1, '标签');

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('更新前应重置 error 为 null', async () => {
      mockPut.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      store.error = '旧错误';
      await store.updateTag(1, '标签');

      expect(store.error).toBeNull();
    });

    it('isLoading 在更新失败后应为 false', async () => {
      mockPut.mockRejectedValue(new Error('fail'));

      const store = useTagStore();
      await store.updateTag(1, 'test');

      expect(store.isLoading).toBe(false);
    });

    it('应使用正确的 API 端点格式更新标签', async () => {
      mockPut.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      await store.updateTag(42, '名称');

      expect(mockPut).toHaveBeenCalledWith('/test-tags/42', { name: '名称' });
    });
  });

  // -------------------------
  // deleteTag
  // -------------------------
  describe('deleteTag', () => {
    it('成功删除后应返回 true 并刷新列表', async () => {
      mockDelete.mockResolvedValue({});
      const remainingTags = [createMockTag({ id: 2, name: '保留标签' })];
      mockGet.mockResolvedValue({ data: remainingTags });

      const store = useTagStore();
      const result = await store.deleteTag(1);

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('/test-tags/1');
      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('成功后（useNotifications=true）应显示成功通知', async () => {
      mockDelete.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      await store.deleteTag(1);

      expect(mockShowSuccess).toHaveBeenCalledWith('标签已删除');
    });

    it('成功后（useNotifications=false）不应显示成功通知', async () => {
      const useSilentStore = makeSilentTagStore();
      mockDelete.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useSilentStore();
      await store.deleteTag(1);

      expect(mockShowSuccess).not.toHaveBeenCalled();
    });

    it('删除失败时应返回 false 并设置错误', async () => {
      mockDelete.mockRejectedValue(new Error('删除失败'));

      const store = useTagStore();
      const result = await store.deleteTag(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
      expect(store.isLoading).toBe(false);
    });

    it('失败时（useNotifications=true）应显示错误通知', async () => {
      mockDelete.mockRejectedValue(new Error('删除失败'));

      const store = useTagStore();
      await store.deleteTag(1);

      expect(mockShowError).toHaveBeenCalledWith('删除失败');
    });

    it('失败时（useNotifications=false）不应显示错误通知', async () => {
      const useSilentStore = makeSilentTagStore();
      mockDelete.mockRejectedValue(new Error('删除失败'));

      const store = useSilentStore();
      await store.deleteTag(1);

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('删除前应重置 error 为 null', async () => {
      mockDelete.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      store.error = '旧错误';
      await store.deleteTag(1);

      expect(store.error).toBeNull();
    });

    it('isLoading 在删除失败后应为 false', async () => {
      mockDelete.mockRejectedValue(new Error('fail'));

      const store = useTagStore();
      await store.deleteTag(1);

      expect(store.isLoading).toBe(false);
    });

    it('应使用正确的 API 端点格式删除标签', async () => {
      mockDelete.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      await store.deleteTag(99);

      expect(mockDelete).toHaveBeenCalledWith('/test-tags/99');
    });
  });

  // -------------------------
  // useNotifications config
  // -------------------------
  describe('useNotifications 配置', () => {
    it('useNotifications=true 时 fetchTags 失败应显示错误通知', async () => {
      mockGet.mockRejectedValue(new Error('error'));

      const store = useTagStore();
      await store.fetchTags();

      expect(mockShowError).toHaveBeenCalled();
    });

    it('useNotifications=false 时 fetchTags 失败不应显示错误通知', async () => {
      mockGet.mockRejectedValue(new Error('error'));
      const useSilentStore = makeSilentTagStore();
      const store = useSilentStore();

      await store.fetchTags();

      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('useNotifications=false 时 addTag 成功不应显示通知', async () => {
      const useSilentStore = makeSilentTagStore();
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useSilentStore();
      await store.addTag('标签');

      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('useNotifications=false 时 updateTag 成功不应显示通知', async () => {
      const useSilentStore = makeSilentTagStore();
      mockPut.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useSilentStore();
      await store.updateTag(1, '名称');

      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockShowError).not.toHaveBeenCalled();
    });

    it('useNotifications=false 时 deleteTag 成功不应显示通知', async () => {
      const useSilentStore = makeSilentTagStore();
      mockDelete.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useSilentStore();
      await store.deleteTag(1);

      expect(mockShowSuccess).not.toHaveBeenCalled();
      expect(mockShowError).not.toHaveBeenCalled();
    });
  });

  // -------------------------
  // storeId isolation
  // -------------------------
  describe('storeId 隔离', () => {
    it('不同 storeId 的 store 应独立维护状态', () => {
      const useSilentStore = makeSilentTagStore();
      const store1 = useTagStore();
      const store2 = useSilentStore();

      const tag = createMockTag({ id: 1, name: '标签1' });
      store1.tags = [tag];

      // Different storeId means isolated state
      expect(store2.tags).toHaveLength(0);
    });

    it('相同 storeId 的 store 实例应共享状态', () => {
      const store1 = useTagStore();
      const store2 = useTagStore();

      const tag = createMockTag({ id: 1, name: '共享标签' });
      store1.tags = [tag];

      expect(store2.tags).toHaveLength(1);
      expect(store2.tags[0].name).toBe('共享标签');
    });
  });

  // -------------------------
  // Error extraction
  // -------------------------
  describe('错误提取', () => {
    it('fetchTags 失败时应使用正确的 fallback 消息', async () => {
      const { extractErrorMessage } = await import('../../utils/errorExtractor');
      const error = new Error('test error');
      mockGet.mockRejectedValue(error);

      const store = useTagStore();
      await store.fetchTags();

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '获取标签列表失败');
    });

    it('addTag 失败时应使用正确的 fallback 消息', async () => {
      const { extractErrorMessage } = await import('../../utils/errorExtractor');
      const error = new Error('test error');
      mockPost.mockRejectedValue(error);

      const store = useTagStore();
      await store.addTag('标签');

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '添加标签失败');
    });

    it('updateTag 失败时应使用正确的 fallback 消息', async () => {
      const { extractErrorMessage } = await import('../../utils/errorExtractor');
      const error = new Error('test error');
      mockPut.mockRejectedValue(error);

      const store = useTagStore();
      await store.updateTag(1, '名称');

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '更新标签失败');
    });

    it('deleteTag 失败时应使用正确的 fallback 消息', async () => {
      const { extractErrorMessage } = await import('../../utils/errorExtractor');
      const error = new Error('test error');
      mockDelete.mockRejectedValue(error);

      const store = useTagStore();
      await store.deleteTag(1);

      expect(extractErrorMessage).toHaveBeenCalledWith(error, '删除标签失败');
    });

    it('应提取 API response.data.error 作为错误消息', async () => {
      const error = { response: { data: { error: '服务器自定义错误' } } };
      mockGet.mockRejectedValue(error);

      const store = useTagStore();
      await store.fetchTags();

      expect(store.error).toBe('服务器自定义错误');
    });
  });

  // -------------------------
  // Cache behavior
  // -------------------------
  describe('缓存行为', () => {
    it('fetchTags 应使用配置的 cacheKey', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      await store.fetchTags();

      expect(localStorage.getItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('addTag 成功后应清除缓存', async () => {
      const newTag = createMockTag({ id: 1 });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockResolvedValue({ data: [newTag] });

      const store = useTagStore();
      await store.addTag('标签');

      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('updateTag 成功后应清除缓存', async () => {
      mockPut.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      await store.updateTag(1, '名称');

      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('deleteTag 成功后应清除缓存', async () => {
      mockDelete.mockResolvedValue({});
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      await store.deleteTag(1);

      expect(localStorage.removeItem).toHaveBeenCalledWith('testTagsCache');
    });

    it('不同 store 应使用不同的 cacheKey', async () => {
      const useSilentStore = makeSilentTagStore();
      mockGet.mockResolvedValue({ data: [] });

      const store = useSilentStore();
      await store.fetchTags();

      expect(localStorage.getItem).toHaveBeenCalledWith('testSilentTagsCache');
      expect(localStorage.getItem).not.toHaveBeenCalledWith('testTagsCache');
    });
  });

  // -------------------------
  // Edge cases and boundary conditions
  // -------------------------
  describe('边界条件', () => {
    it('fetchTags 返回空数组时 tags 应为空', async () => {
      mockGet.mockResolvedValue({ data: [] });

      const store = useTagStore();
      const result = await store.fetchTags();

      expect(result).toBe(true);
      expect(store.tags).toEqual([]);
    });

    it('addTag 成功后 fetchTags 失败时应正确处理', async () => {
      const newTag = createMockTag({ id: 3, name: '新标签' });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockGet.mockRejectedValue(new Error('fetch failed'));

      const store = useTagStore();
      const result = await store.addTag('新标签');

      // addTag itself should still return the newTag even if fetchTags fails
      expect(result).toEqual(newTag);
    });

    it('isLoading 在所有操作成功后应为 false', async () => {
      const newTag = createMockTag({ id: 1 });
      mockGet.mockResolvedValue({ data: [newTag] });
      mockPost.mockResolvedValue({ data: { message: 'ok', tag: newTag } });
      mockPut.mockResolvedValue({});
      mockDelete.mockResolvedValue({});

      const store = useTagStore();

      await store.fetchTags();
      expect(store.isLoading).toBe(false);

      await store.addTag('标签');
      expect(store.isLoading).toBe(false);

      await store.updateTag(1, '名称');
      expect(store.isLoading).toBe(false);

      await store.deleteTag(1);
      expect(store.isLoading).toBe(false);
    });

    it('isLoading 在所有操作失败后应为 false', async () => {
      mockGet.mockRejectedValue(new Error('fail'));
      mockPost.mockRejectedValue(new Error('fail'));
      mockPut.mockRejectedValue(new Error('fail'));
      mockDelete.mockRejectedValue(new Error('fail'));

      const store = useTagStore();

      await store.fetchTags();
      expect(store.isLoading).toBe(false);

      await store.addTag('标签');
      expect(store.isLoading).toBe(false);

      await store.updateTag(1, '名称');
      expect(store.isLoading).toBe(false);

      await store.deleteTag(1);
      expect(store.isLoading).toBe(false);
    });

    it('extractErrorMessage 返回空字符串时（useNotifications=true）不应显示通知', async () => {
      // Make extractErrorMessage return empty string
      const { extractErrorMessage } = await import('../../utils/errorExtractor');
      (extractErrorMessage as ReturnType<typeof vi.fn>).mockReturnValueOnce('');

      mockGet.mockRejectedValue(new Error('error'));

      const store = useTagStore();
      await store.fetchTags();

      // Error is empty string - useNotifications is true but error is falsy
      expect(mockShowError).not.toHaveBeenCalled();
    });
  });
});
