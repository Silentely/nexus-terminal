/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

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

// Mock extractErrorMessage
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
    if (err && typeof err === 'object' && 'response' in err) {
      const apiErr = err as { response?: { data?: { error?: string } } };
      return apiErr.response?.data?.error || fallback;
    }
    if (err instanceof Error) return err.message;
    return fallback;
  }),
}));

// 辅助：创建模拟代理对象
const createMockProxy = (
  overrides: Partial<{
    id: number;
    name: string;
    type: 'SOCKS5' | 'HTTP';
    host: string;
    port: number;
    username: string | null;
    created_at: number;
    updated_at: number;
  }> = {},
) => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? '测试代理',
  type: overrides.type ?? ('SOCKS5' as const),
  host: overrides.host ?? '127.0.0.1',
  port: overrides.port ?? 1080,
  username: overrides.username ?? null,
  created_at: overrides.created_at ?? Date.now(),
  updated_at: overrides.updated_at ?? Date.now(),
});

describe('proxies.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的默认状态', async () => {
      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      expect(store.proxies).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchProxies', () => {
    it('应该成功获取代理列表并更新状态', async () => {
      const mockProxies = [
        createMockProxy({ id: 1, name: '代理A' }),
        createMockProxy({ id: 2, name: '代理B', type: 'HTTP', port: 8080 }),
      ];
      mockGet.mockResolvedValue({ data: mockProxies });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      await store.fetchProxies();

      expect(mockGet).toHaveBeenCalledWith('/proxies');
      expect(store.proxies).toEqual(mockProxies);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('获取代理列表时应该设置 isLoading 为 true', async () => {
      let resolveGet: (value: unknown) => void;
      mockGet.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveGet = resolve;
          }),
      );

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      const fetchPromise = store.fetchProxies();
      expect(store.isLoading).toBe(true);

      resolveGet!({ data: [] });
      await fetchPromise;

      expect(store.isLoading).toBe(false);
    });

    it('获取代理列表失败时应该设置错误信息', async () => {
      const error = new Error('网络错误');
      mockGet.mockRejectedValue(error);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      await store.fetchProxies();

      expect(store.error).toBe('网络错误');
      expect(store.isLoading).toBe(false);
      expect(store.proxies).toEqual([]);
    });

    it('获取代理列表失败且为 API 错误时应提取 response.data.error', async () => {
      const apiError = { response: { data: { error: '服务器内部错误' } } };
      mockGet.mockRejectedValue(apiError);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      await store.fetchProxies();

      expect(store.error).toBe('服务器内部错误');
    });

    it('获取代理列表失败且无具体错误信息时应使用后备消息', async () => {
      mockGet.mockRejectedValue(null);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      await store.fetchProxies();

      expect(store.error).toBe('获取代理列表时发生未知错误。');
    });
  });

  describe('addProxy', () => {
    it('应该成功添加代理并插入到列表头部', async () => {
      const existingProxy = createMockProxy({ id: 1, name: '旧代理' });
      const newProxyData = {
        name: '新代理',
        type: 'SOCKS5' as const,
        host: '10.0.0.1',
        port: 1080,
        username: 'user1',
        password: 'pass1',
      };
      const returnedProxy = createMockProxy({ id: 2, name: '新代理', host: '10.0.0.1' });
      mockPost.mockResolvedValue({ data: { message: '添加成功', proxy: returnedProxy } });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [existingProxy];

      const result = await store.addProxy(newProxyData);

      expect(result).toBe(true);
      expect(mockPost).toHaveBeenCalledWith('/proxies', newProxyData);
      expect(store.proxies[0]).toEqual(returnedProxy);
      expect(store.proxies).toHaveLength(2);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('添加代理时应该设置 isLoading 为 true', async () => {
      let resolvePost: (value: unknown) => void;
      mockPost.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePost = resolve;
          }),
      );

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      const addPromise = store.addProxy({
        name: '测试',
        type: 'SOCKS5',
        host: '127.0.0.1',
        port: 1080,
      });
      expect(store.isLoading).toBe(true);

      resolvePost!({ data: { message: 'ok', proxy: createMockProxy() } });
      await addPromise;

      expect(store.isLoading).toBe(false);
    });

    it('添加代理失败时应该返回 false 并设置错误信息', async () => {
      const error = new Error('名称已存在');
      mockPost.mockRejectedValue(error);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      const result = await store.addProxy({
        name: '重复代理',
        type: 'HTTP',
        host: '127.0.0.1',
        port: 8080,
      });

      expect(result).toBe(false);
      expect(store.error).toBe('名称已存在');
      expect(store.isLoading).toBe(false);
    });

    it('添加代理失败且为 API 409 冲突时应提取错误信息', async () => {
      const apiError = { response: { data: { error: '代理名称已存在' } } };
      mockPost.mockRejectedValue(apiError);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      const result = await store.addProxy({
        name: '冲突代理',
        type: 'SOCKS5',
        host: '10.0.0.1',
        port: 1080,
      });

      expect(result).toBe(false);
      expect(store.error).toBe('代理名称已存在');
    });

    it('添加代理时应正确处理 username 为 null 的情况', async () => {
      const returnedProxy = createMockProxy({ id: 3, username: null });
      mockPost.mockResolvedValue({ data: { message: 'ok', proxy: returnedProxy } });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      const result = await store.addProxy({
        name: '无用户名代理',
        type: 'HTTP',
        host: '192.168.1.1',
        port: 3128,
        username: null,
        password: null,
      });

      expect(result).toBe(true);
      expect(store.proxies[0].username).toBeNull();
    });
  });

  describe('updateProxy', () => {
    it('应该成功更新已存在的代理', async () => {
      const existingProxy = createMockProxy({ id: 1, name: '旧名称' });
      const updatedProxy = createMockProxy({ id: 1, name: '新名称' });
      mockPut.mockResolvedValue({ data: { message: '更新成功', proxy: updatedProxy } });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [existingProxy];

      const result = await store.updateProxy(1, { name: '新名称' });

      expect(result).toBe(true);
      expect(mockPut).toHaveBeenCalledWith('/proxies/1', { name: '新名称' });
      expect(store.proxies[0].name).toBe('新名称');
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('更新不存在的代理时应该重新获取列表', async () => {
      const updatedProxy = createMockProxy({ id: 99, name: '远程代理' });
      mockPut.mockResolvedValue({ data: { message: 'ok', proxy: updatedProxy } });
      mockGet.mockResolvedValue({ data: [updatedProxy] });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = []; // 列表为空，找不到 id=99

      const result = await store.updateProxy(99, { name: '远程代理' });

      expect(result).toBe(true);
      expect(mockGet).toHaveBeenCalledWith('/proxies');
    });

    it('更新代理时应该正确合并字段', async () => {
      const existingProxy = createMockProxy({
        id: 1,
        name: '代理A',
        host: '10.0.0.1',
        port: 1080,
      });
      const partialUpdate = createMockProxy({ id: 1, name: '代理A-更新', host: '10.0.0.2' });
      mockPut.mockResolvedValue({ data: { message: 'ok', proxy: partialUpdate } });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [existingProxy];

      await store.updateProxy(1, { host: '10.0.0.2' });

      expect(store.proxies[0]).toEqual(partialUpdate);
    });

    it('更新代理失败时应该返回 false 并设置错误信息', async () => {
      const error = new Error('更新失败');
      mockPut.mockRejectedValue(error);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const result = await store.updateProxy(1, { name: '失败更新' });

      expect(result).toBe(false);
      expect(store.error).toBe('更新失败');
      expect(store.isLoading).toBe(false);
    });

    it('更新代理失败且为 API 冲突错误时应提取错误信息', async () => {
      const apiError = { response: { data: { error: '名称冲突' } } };
      mockPut.mockRejectedValue(apiError);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const result = await store.updateProxy(1, { name: '冲突名' });

      expect(result).toBe(false);
      expect(store.error).toBe('名称冲突');
    });

    it('更新代理时应该设置 isLoading 为 true', async () => {
      let resolvePut: (value: unknown) => void;
      mockPut.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePut = resolve;
          }),
      );

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const updatePromise = store.updateProxy(1, { name: '测试' });
      expect(store.isLoading).toBe(true);

      resolvePut!({ data: { message: 'ok', proxy: createMockProxy({ id: 1 }) } });
      await updatePromise;

      expect(store.isLoading).toBe(false);
    });
  });

  describe('deleteProxy', () => {
    it('应该成功删除代理并从列表中移除', async () => {
      const proxy1 = createMockProxy({ id: 1, name: '代理A' });
      const proxy2 = createMockProxy({ id: 2, name: '代理B' });
      mockDelete.mockResolvedValue({});

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [proxy1, proxy2];

      const result = await store.deleteProxy(1);

      expect(result).toBe(true);
      expect(mockDelete).toHaveBeenCalledWith('/proxies/1');
      expect(store.proxies).toHaveLength(1);
      expect(store.proxies[0].id).toBe(2);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('删除不存在的代理 ID 时应保持列表不变', async () => {
      mockDelete.mockResolvedValue({});

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const result = await store.deleteProxy(999);

      expect(result).toBe(true);
      expect(store.proxies).toHaveLength(1);
    });

    it('删除代理失败时应该返回 false 并设置错误信息', async () => {
      const error = new Error('删除失败');
      mockDelete.mockRejectedValue(error);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const result = await store.deleteProxy(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
      expect(store.isLoading).toBe(false);
      // 列表应保持不变
      expect(store.proxies).toHaveLength(1);
    });

    it('删除代理失败且为 API 错误时应提取错误信息', async () => {
      const apiError = { response: { data: { error: '代理正在使用中' } } };
      mockDelete.mockRejectedValue(apiError);

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const result = await store.deleteProxy(1);

      expect(result).toBe(false);
      expect(store.error).toBe('代理正在使用中');
    });

    it('删除代理时应该设置 isLoading 为 true', async () => {
      let resolveDelete: (value: unknown) => void;
      mockDelete.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveDelete = resolve;
          }),
      );

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 })];

      const deletePromise = store.deleteProxy(1);
      expect(store.isLoading).toBe(true);

      resolveDelete!({});
      await deletePromise;

      expect(store.isLoading).toBe(false);
    });

    it('删除所有代理后列表应为空', async () => {
      mockDelete.mockResolvedValue({});

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [createMockProxy({ id: 1 }), createMockProxy({ id: 2 })];

      await store.deleteProxy(1);
      await store.deleteProxy(2);

      expect(store.proxies).toEqual([]);
    });
  });

  describe('边界条件', () => {
    it('多次连续调用 fetchProxies 应正确处理竞态', async () => {
      const proxies1 = [createMockProxy({ id: 1, name: '第一批' })];
      const proxies2 = [createMockProxy({ id: 2, name: '第二批' })];

      let resolveFirst: (value: unknown) => void;
      let resolveSecond: (value: unknown) => void;
      mockGet
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveFirst = resolve;
            }),
        )
        .mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              resolveSecond = resolve;
            }),
        );

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      const first = store.fetchProxies();
      const second = store.fetchProxies();

      // 第二个请求先完成
      resolveSecond!({ data: proxies2 });
      await second;

      // 第一个请求后完成
      resolveFirst!({ data: proxies1 });
      await first;

      // 最终结果取决于最后一个完成的请求
      expect(store.isLoading).toBe(false);
    });

    it('连续操作 addProxy 后 fetchProxies 应保持状态正确', async () => {
      const newProxy = createMockProxy({ id: 1, name: '新建' });
      mockPost.mockResolvedValue({ data: { message: 'ok', proxy: newProxy } });
      mockGet.mockResolvedValue({ data: [newProxy] });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      await store.addProxy({ name: '新建', type: 'SOCKS5', host: '127.0.0.1', port: 1080 });
      await store.fetchProxies();

      expect(store.proxies).toHaveLength(1);
      expect(store.error).toBeNull();
    });

    it('多个 store 实例应共享同一份状态', async () => {
      const { useProxiesStore } = await import('./proxies.store');
      const store1 = useProxiesStore();
      const store2 = useProxiesStore();

      store1.proxies = [createMockProxy({ id: 1 })];

      expect(store2.proxies).toHaveLength(1);
      expect(store2.proxies[0].id).toBe(1);
    });

    it('error 应在成功操作后被清除', async () => {
      mockGet.mockRejectedValueOnce(new Error('首次失败'));

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();

      await store.fetchProxies();
      expect(store.error).toBe('首次失败');

      mockGet.mockResolvedValueOnce({ data: [] });
      await store.fetchProxies();
      expect(store.error).toBeNull();
    });

    it('addProxy 后新代理应出现在列表头部而非尾部', async () => {
      const oldProxy = createMockProxy({ id: 1, name: '旧代理' });
      const newProxy = createMockProxy({ id: 2, name: '新代理' });
      mockPost.mockResolvedValue({ data: { message: 'ok', proxy: newProxy } });

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [oldProxy];

      await store.addProxy({ name: '新代理', type: 'SOCKS5', host: '127.0.0.1', port: 1080 });

      expect(store.proxies[0].id).toBe(2);
      expect(store.proxies[1].id).toBe(1);
    });

    it('deleteProxy 仅删除匹配 ID 的代理，不影响其他代理', async () => {
      mockDelete.mockResolvedValue({});

      const { useProxiesStore } = await import('./proxies.store');
      const store = useProxiesStore();
      store.proxies = [
        createMockProxy({ id: 1, name: '保留' }),
        createMockProxy({ id: 2, name: '删除' }),
        createMockProxy({ id: 3, name: '保留2' }),
      ];

      await store.deleteProxy(2);

      expect(store.proxies).toHaveLength(2);
      expect(store.proxies.find((p) => p.id === 2)).toBeUndefined();
      expect(store.proxies.find((p) => p.id === 1)).toBeDefined();
      expect(store.proxies.find((p) => p.id === 3)).toBeDefined();
    });
  });
});
