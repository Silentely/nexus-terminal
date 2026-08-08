import { defineStore } from 'pinia';
import { ref } from 'vue';

export const DEFAULT_NOTIFICATION_TIMEOUT_MS = 3000;
export const DEDUPE_WINDOW_MS = 15000;
export const DEDUPE_CLEANUP_INTERVAL_MS = 60000;

const parsePositiveIntWithFallback = (raw: string | undefined, fallback: number): number => {
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resolveNotificationTimeoutMs = (raw: string | undefined): number =>
  parsePositiveIntWithFallback(raw, DEFAULT_NOTIFICATION_TIMEOUT_MS);

export const pruneExpiredNotificationKeys = (
  cache: Map<string, number>,
  now: number,
  expireMs: number,
): number => {
  let removed = 0;
  for (const [key, shownAt] of cache) {
    if (now - shownAt > expireMs) {
      cache.delete(key);
      removed++;
    }
  }
  return removed;
};

// 通知类型（供展示组件与调用方复用）
export type UINotificationType = 'success' | 'error' | 'info' | 'warning';

// 定义通知对象的接口
export interface UINotification {
  id: number;
  type: UINotificationType;
  message: string;
  timeout?: number; // 可选的自动关闭超时时间 (毫秒)
}

export const useUiNotificationsStore = defineStore('uiNotifications', () => {
  const notifications = ref<UINotification[]>([]);
  let nextId = 0;
  const notificationTimeoutMs = resolveNotificationTimeoutMs(
    import.meta.env?.VITE_NOTIFICATION_TIMEOUT_MS,
  );
  const lastNotificationAt = new Map<string, number>();
  let lastCleanupAt = Date.now();

  const maybeCleanupDedupeCache = (now: number) => {
    if (now - lastCleanupAt < DEDUPE_CLEANUP_INTERVAL_MS) return;
    pruneExpiredNotificationKeys(lastNotificationAt, now, DEDUPE_WINDOW_MS);
    lastCleanupAt = now;
  };

  /**
   * 添加一个新通知
   * @param notification - 通知对象 (至少包含 type 和 message)
   */
  const addNotification = (notification: Omit<UINotification, 'id'> & { timeout?: number }) => {
    // 错误与警告类通知在短时间窗口内去重，避免轮询失败导致刷屏。
    if (notification.type === 'error' || notification.type === 'warning') {
      const dedupeKey = `${notification.type}:${notification.message}`;
      const now = Date.now();
      maybeCleanupDedupeCache(now);
      const recentShownAt = lastNotificationAt.get(dedupeKey);

      if (recentShownAt && now - recentShownAt < DEDUPE_WINDOW_MS) {
        return;
      }
      lastNotificationAt.set(dedupeKey, now);
    }

    const id = nextId++;
    // 优先使用单条通知的自定义超时，缺省回退全局配置
    const effectiveTimeout = notification.timeout ?? notificationTimeoutMs;
    const newNotification: UINotification = {
      ...notification,
      id,
      timeout: effectiveTimeout,
    };
    notifications.value.push(newNotification);

    // 按有效超时自动移除通知
    setTimeout(() => {
      removeNotification(id);
    }, effectiveTimeout);
  };

  /**
   * 移除一个通知
   * @param id - 要移除的通知的 ID
   */
  const removeNotification = (id: number) => {
    notifications.value = notifications.value.filter((n) => n.id !== id);
  };

  // 便捷方法（超时由 addNotification 统一处理）
  const showError = (message: string) => {
    addNotification({ type: 'error', message });
  };

  const showSuccess = (message: string) => {
    addNotification({ type: 'success', message });
  };

  const showInfo = (message: string) => {
    addNotification({ type: 'info', message });
  };

  const showWarning = (message: string) => {
    addNotification({ type: 'warning', message });
  };

  return {
    notifications,
    addNotification,
    removeNotification,
    showError,
    showSuccess,
    showInfo,
    showWarning,
  };
});
