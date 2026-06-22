import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import apiClient from '../utils/apiClient';
import { useFavoritePathsStore } from './favoritePaths.store';

const { uiNotificationsStoreMock } = vi.hoisted(() => {
  return {
    uiNotificationsStoreMock: {
      addNotification: vi.fn(),
      showError: vi.fn(),
      showSuccess: vi.fn(),
    },
  };
});

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock('./uiNotifications.store', () => ({
  useUiNotificationsStore: () => uiNotificationsStoreMock,
}));

const t = (_key: string, defaultMessage: string) => defaultMessage;

describe('favoritePaths.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    (window.localStorage.getItem as any).mockReturnValue(null);
  });

  it('state 初始化时应从 localStorage 读取排序字段', () => {
    (window.localStorage.getItem as any).mockReturnValue('last_used_at');
    const store = useFavoritePathsStore();
    expect(store.currentSortBy).toBe('last_used_at');
  });

  it('_sortFavoritePaths 按 name 排序时应优先使用 name，否则使用 path', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/b', name: 'B', created_at: 1000 },
      { id: 2, path: '/a', name: null, created_at: 1001 }, // no name
      { id: 3, path: '/c', name: 'a', created_at: 1002 },
    ];

    store.currentSortBy = 'name';
    store._sortFavoritePaths();

    expect(store.favoritePaths.map((p) => p.id)).toEqual([2, 3, 1]);
  });

  it('fetchFavoritePaths 成功时应写入列表并进行本地排序', async () => {
    const store = useFavoritePathsStore();
    (apiClient.get as any).mockResolvedValueOnce({
      data: [
        { id: 2, path: '/b', name: 'b', created_at: 1001 },
        { id: 1, path: '/a', name: 'a', created_at: 1000 },
      ],
    });

    await store.fetchFavoritePaths(t);
    expect(store.favoritePaths.map((p) => p.id)).toEqual([1, 2]);
    expect(store.isLoading).toBe(false);
    expect(store.error).toBeNull();
  });

  it('fetchFavoritePaths 失败时应设置 error 并允许重新初始化', async () => {
    const store = useFavoritePathsStore();
    store.isInitialized = true;
    (apiClient.get as any).mockRejectedValueOnce(new Error('boom'));

    await store.fetchFavoritePaths(t);
    expect(store.error).toContain('boom');
    expect(store.isInitialized).toBe(false);
    expect(store.isLoading).toBe(false);
  });

  it('setSortBy 应保存到 localStorage 并触发重新排序', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/a', name: null, last_used_at: 1, created_at: 1000 },
      { id: 2, path: '/b', name: null, last_used_at: 5, created_at: 1001 },
    ];

    store.setSortBy('last_used_at');
    expect(window.localStorage.setItem).toHaveBeenCalledWith('favoritePathSortBy', 'last_used_at');
    expect(store.favoritePaths.map((p) => p.id)).toEqual([2, 1]);
  });

  it('markPathAsUsed 成功且返回 updatedPath 时应更新并重新排序', async () => {
    const store = useFavoritePathsStore();
    store.currentSortBy = 'last_used_at';
    store.favoritePaths = [{ id: 1, path: '/a', name: null, last_used_at: 1, created_at: 1000 }];

    (apiClient.put as any).mockResolvedValueOnce({
      data: { favoritePath: { id: 1, path: '/a', name: null, last_used_at: 99, created_at: 1000 } },
    });

    await store.markPathAsUsed(1, t);
    expect(store.favoritePaths[0].last_used_at).toBe(99);
  });

  it('markPathAsUsed 返回数据不包含 updatedPath 时应回退到重新拉取列表', async () => {
    const store = useFavoritePathsStore();
    (apiClient.put as any).mockResolvedValueOnce({ data: { favoritePath: null } });
    (apiClient.get as any).mockResolvedValueOnce({ data: [] });

    await store.markPathAsUsed(1, t);
    expect(apiClient.get).toHaveBeenCalledWith('/favorite-paths');
  });

  it('addFavoritePath 失败时应提示通知并向上抛出', async () => {
    const store = useFavoritePathsStore();
    (apiClient.post as any).mockRejectedValueOnce(new Error('nope'));

    await expect(store.addFavoritePath({ path: '/x', name: 'x' } as any, t)).rejects.toThrow(
      'nope',
    );

    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalled();
  });

  it('filteredFavoritePaths 搜索为空时应返回全部列表', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/a', name: 'Alpha', created_at: 1000 },
      { id: 2, path: '/b', name: 'Beta', created_at: 1001 },
    ];
    store.searchTerm = '';
    expect(store.filteredFavoritePaths).toHaveLength(2);
  });

  it('filteredFavoritePaths 应按 path 匹配过滤', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/home/user', name: 'Home', created_at: 1000 },
      { id: 2, path: '/var/log', name: 'Logs', created_at: 1001 },
    ];
    store.searchTerm = 'home';
    expect(store.filteredFavoritePaths).toHaveLength(1);
    expect(store.filteredFavoritePaths[0].id).toBe(1);
  });

  it('filteredFavoritePaths 应按 name 匹配过滤', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/a', name: 'Alpha', created_at: 1000 },
      { id: 2, path: '/b', name: 'Beta', created_at: 1001 },
    ];
    store.searchTerm = 'beta';
    expect(store.filteredFavoritePaths).toHaveLength(1);
    expect(store.filteredFavoritePaths[0].id).toBe(2);
  });

  it('filteredFavoritePaths 无匹配时应返回空列表', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [{ id: 1, path: '/a', name: 'Alpha', created_at: 1000 }];
    store.searchTerm = 'zzz';
    expect(store.filteredFavoritePaths).toHaveLength(0);
  });

  it('getFavoritePathById 应返回对应路径', () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/a', name: 'A', created_at: 1000 },
      { id: 2, path: '/b', name: 'B', created_at: 1001 },
    ];
    expect(store.getFavoritePathById(1)).toEqual(store.favoritePaths[0]);
    expect(store.getFavoritePathById(99)).toBeUndefined();
  });

  it('setSearchTerm 应设置搜索词', () => {
    const store = useFavoritePathsStore();
    store.setSearchTerm('test');
    expect(store.searchTerm).toBe('test');
  });

  it('initializeFavoritePaths 已初始化时应跳过', async () => {
    const store = useFavoritePathsStore();
    store.isInitialized = true;
    await store.initializeFavoritePaths(t);
    expect(apiClient.get).not.toHaveBeenCalled();
  });

  it('initializeFavoritePaths 未初始化时应调用 fetchFavoritePaths', async () => {
    const store = useFavoritePathsStore();
    (apiClient.get as any).mockResolvedValueOnce({ data: [] });
    await store.initializeFavoritePaths(t);
    expect(apiClient.get).toHaveBeenCalled();
    expect(store.isInitialized).toBe(true);
  });

  it('addFavoritePath 成功时应添加到列表并显示成功通知', async () => {
    const store = useFavoritePathsStore();
    const newItem = { id: 10, path: '/new', name: 'New', created_at: 2000 };
    (apiClient.post as any).mockResolvedValueOnce({ data: { favoritePath: newItem } });

    await store.addFavoritePath({ path: '/new', name: 'New' } as any, t);
    expect(store.favoritePaths).toContainEqual(newItem);
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('updateFavoritePath 成功时应更新对应项', async () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [{ id: 1, path: '/a', name: 'Old', created_at: 1000 }];
    const updated = { id: 1, path: '/a', name: 'New', created_at: 1000 };
    (apiClient.put as any).mockResolvedValueOnce({ data: { favoritePath: updated } });

    await store.updateFavoritePath(1, { name: 'New' }, t);
    expect(store.favoritePaths[0].name).toBe('New');
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('updateFavoritePath 成功但 id 未找到时应不修改列表但仍显示通知', async () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [{ id: 1, path: '/a', name: 'Old', created_at: 1000 }];
    const updated = { id: 99, path: '/other', name: 'Other', created_at: 1000 };
    (apiClient.put as any).mockResolvedValueOnce({ data: { favoritePath: updated } });

    await store.updateFavoritePath(99, { name: 'Other' }, t);
    expect(store.favoritePaths).toHaveLength(1);
    expect(store.favoritePaths[0].name).toBe('Old');
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalled();
  });

  it('updateFavoritePath 失败时应设置 error 并抛出', async () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [{ id: 1, path: '/a', name: 'A', created_at: 1000 }];
    (apiClient.put as any).mockRejectedValueOnce(new Error('fail'));

    await expect(store.updateFavoritePath(1, { name: 'X' }, t)).rejects.toThrow('fail');
    expect(store.error).toContain('fail');
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('deleteFavoritePath 成功时应移除该项', async () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [
      { id: 1, path: '/a', name: 'A', created_at: 1000 },
      { id: 2, path: '/b', name: 'B', created_at: 1001 },
    ];
    (apiClient.delete as any).mockResolvedValueOnce({});

    await store.deleteFavoritePath(1, t);
    expect(store.favoritePaths).toHaveLength(1);
    expect(store.favoritePaths[0].id).toBe(2);
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'success' }),
    );
  });

  it('deleteFavoritePath 失败时应设置 error 并显示通知', async () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [{ id: 1, path: '/a', name: 'A', created_at: 1000 }];
    (apiClient.delete as any).mockRejectedValueOnce(new Error('del-fail'));

    await store.deleteFavoritePath(1, t);
    expect(store.error).toContain('del-fail');
    expect(store.favoritePaths).toHaveLength(1);
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('markPathAsUsed 路径不在本地列表时应追加新路径', async () => {
    const store = useFavoritePathsStore();
    store.favoritePaths = [{ id: 1, path: '/a', name: 'A', created_at: 1000 }];
    const updated = { id: 2, path: '/b', name: 'B', last_used_at: 99, created_at: 1001 };
    (apiClient.put as any).mockResolvedValueOnce({
      data: { favoritePath: updated },
    });

    await store.markPathAsUsed(2, t);
    expect(store.favoritePaths).toContainEqual(updated);
  });

  it('markPathAsUsed 失败时应显示错误通知', async () => {
    const store = useFavoritePathsStore();
    (apiClient.put as any).mockRejectedValueOnce(new Error('used-fail'));

    await store.markPathAsUsed(1, t);
    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'error' }),
    );
  });

  it('_sortFavoritePaths 按 last_used_at 排序时 null/undefined 应排在最后', () => {
    const store = useFavoritePathsStore();
    store.currentSortBy = 'last_used_at';
    store.favoritePaths = [
      { id: 1, path: '/a', name: 'A', last_used_at: null, created_at: 1000 },
      { id: 2, path: '/b', name: 'B', last_used_at: 50, created_at: 1001 },
      { id: 3, path: '/c', name: 'C', last_used_at: undefined, created_at: 1002 },
      { id: 4, path: '/d', name: 'D', last_used_at: 100, created_at: 1003 },
    ];
    store._sortFavoritePaths();
    expect(store.favoritePaths.map((p) => p.id)).toEqual([4, 2, 1, 3]);
  });
});
