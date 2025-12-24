import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

import apiClient from '../utils/apiClient';
import { useFavoritePathsStore, type FavoritePathItem } from './favoritePaths.store';

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
      'nope'
    );

    expect(uiNotificationsStoreMock.addNotification).toHaveBeenCalled();
  });
});
