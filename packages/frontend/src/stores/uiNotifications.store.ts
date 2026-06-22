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

// 定义通知对象的接口
export interface UINotification {
  id: number;
  type: 'success' | 'error' | 'info' | 'warning';
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
    if (notification.type === 'error') {
      const dedupeKey = `${notification.type}:${notification.message}`;
      const now = Date.now();
      maybeCleanupDedupeCache(now);
      const recentShownAt = lastNotificationAt.get(dedupeKey);

      // 在短时间窗口内抑制重复错误通知，避免轮询失败导致刷屏。
      if (recentShownAt && now - recentShownAt < DEDUPE_WINDOW_MS) {
        return;
      }
      lastNotificationAt.set(dedupeKey, now);
    }

    // Ensure timeout is part of the input type for clarity
    const id = nextId++;
    // Force a fixed timeout for all notifications
    const newNotification: UINotification = {
      ...notification,
      id,
      timeout: notificationTimeoutMs,
    };
    notifications.value.push(newNotification);

    // Always set timeout to remove the notification automatically
    setTimeout(() => {
      removeNotification(id);
    }, notificationTimeoutMs);
  };

  /**
   * 移除一个通知
   * @param id - 要移除的通知的 ID
   */
  const removeNotification = (id: number) => {
    notifications.value = notifications.value.filter((n) => n.id !== id);
  };

  // 便捷方法
  const showError = (message: string) => {
    // Removed options
    addNotification({ type: 'error', message }); // Timeout is handled by addNotification
  };

  const showSuccess = (message: string) => {
    // Removed options
    addNotification({ type: 'success', message }); // Timeout is handled by addNotification
  };

  const showInfo = (message: string) => {
    // Removed options
    addNotification({ type: 'info', message }); // Timeout is handled by addNotification
  };

  const showWarning = (message: string) => {
    // Removed options
    addNotification({ type: 'warning', message }); // Timeout is handled by addNotification
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
