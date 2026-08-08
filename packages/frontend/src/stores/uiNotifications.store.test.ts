import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';

const loadStoreModule = async () => {
  vi.resetModules();
  return import('./uiNotifications.store');
};

describe('uiNotifications.store', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    setActivePinia(createPinia());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it('回归：未配置 VITE_NOTIFICATION_TIMEOUT_MS 时应回退默认超时', async () => {
    vi.stubEnv('VITE_NOTIFICATION_TIMEOUT_MS', '');
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.addNotification({ type: 'info', message: 'hello' });
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0]?.timeout).toBe(mod.DEFAULT_NOTIFICATION_TIMEOUT_MS);

    vi.advanceTimersByTime(mod.DEFAULT_NOTIFICATION_TIMEOUT_MS - 1);
    expect(store.notifications).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(store.notifications).toHaveLength(0);
  });

  it('应按清理策略删除过期去重缓存记录', async () => {
    const mod = await loadStoreModule();
    const dedupeCache = new Map<string, number>([
      ['error:a', 0],
      ['error:b', 10_000],
      ['error:c', 70_000],
    ]);

    const removed = mod.pruneExpiredNotificationKeys(dedupeCache, 80_000, mod.DEDUPE_WINDOW_MS);

    expect(removed).toBe(2);
    expect(dedupeCache.has('error:a')).toBe(false);
    expect(dedupeCache.has('error:b')).toBe(false);
    expect(dedupeCache.has('error:c')).toBe(true);
  });

  it('重复错误通知应在去重窗口内被抑制', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showError('连接失败');
    expect(store.notifications).toHaveLength(1);

    // 短时间内重复添加相同错误应被抑制
    store.showError('连接失败');
    expect(store.notifications).toHaveLength(1);
  });

  it('不同类型通知不受去重影响', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showError('错误');
    store.showSuccess('成功');
    store.showInfo('信息');
    store.showWarning('警告');

    expect(store.notifications).toHaveLength(4);
  });

  it('相同错误消息在去重窗口过期后应允许再次显示', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showError('超时错误');
    expect(store.notifications).toHaveLength(1);

    // 推进时间超过去重窗口，但不超过自动移除超时
    vi.advanceTimersByTime(mod.DEDUPE_WINDOW_MS + 1);

    store.showError('超时错误');
    // 旧通知已自动移除（超过默认超时），新通知刚添加
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].message).toBe('超时错误');
  });

  it('removeNotification 应按 ID 移除指定通知', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showInfo('A');
    store.showInfo('B');
    expect(store.notifications).toHaveLength(2);

    const firstId = store.notifications[0].id;
    store.removeNotification(firstId);
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].message).toBe('B');
  });

  it('通知应自动超时移除', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showInfo('自动消失');
    expect(store.notifications).toHaveLength(1);

    vi.advanceTimersByTime(mod.DEFAULT_NOTIFICATION_TIMEOUT_MS);
    expect(store.notifications).toHaveLength(0);
  });

  it('单条通知的自定义 timeout 应覆盖全局默认值', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.addNotification({ type: 'info', message: '长时间提示', timeout: 10000 });
    expect(store.notifications[0]?.timeout).toBe(10000);

    // 超过默认超时但未到自定义超时，通知应仍在
    vi.advanceTimersByTime(mod.DEFAULT_NOTIFICATION_TIMEOUT_MS + 100);
    expect(store.notifications).toHaveLength(1);

    // 到达自定义超时后移除
    vi.advanceTimersByTime(10000 - mod.DEFAULT_NOTIFICATION_TIMEOUT_MS);
    expect(store.notifications).toHaveLength(0);
  });

  it('重复警告通知应在去重窗口内被抑制', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showWarning('磁盘空间不足');
    expect(store.notifications).toHaveLength(1);

    store.showWarning('磁盘空间不足');
    expect(store.notifications).toHaveLength(1);
  });

  it('相同警告消息在去重窗口过期后应允许再次显示', async () => {
    const mod = await loadStoreModule();
    setActivePinia(createPinia());
    const store = mod.useUiNotificationsStore();

    store.showWarning('连接不稳定');
    expect(store.notifications).toHaveLength(1);

    vi.advanceTimersByTime(mod.DEDUPE_WINDOW_MS + 1);
    store.showWarning('连接不稳定');
    expect(store.notifications).toHaveLength(1);
    expect(store.notifications[0].message).toBe('连接不稳定');
  });
});
