// packages/frontend/src/stores/session/getters.ts

import { computed } from 'vue';
import { sessions, activeSessionId } from './state';
import type { SessionState, SessionTabInfoWithStatus } from './types';

export const sessionTabs = computed(() => {
  return Array.from(sessions.value.values()).map((session) => ({
    sessionId: session.sessionId,
    connectionName: session.connectionName,
  }));
});

// 包含状态的标签页信息
export const sessionTabsWithStatus = computed((): SessionTabInfoWithStatus[] => {
  const sessionOrderStr = localStorage.getItem('sessionOrder');
  let sessionOrder: string[] = [];
  if (sessionOrderStr) {
    try {
      sessionOrder = JSON.parse(sessionOrderStr);
      console.log('[SessionGetters] 使用本地存储的用户自定义标签顺序');
    } catch (e) {
      console.error('[SessionGetters] 解析本地存储的标签顺序失败:', e);
      sessionOrder = [];
    }
  }

  const sessionList = Array.from(sessions.value.values());
  if (sessionOrder.length > 0) {
    // 按照用户自定义顺序排序
    return sessionList
      .sort((a, b) => {
        const indexA = sessionOrder.indexOf(a.sessionId);
        const indexB = sessionOrder.indexOf(b.sessionId);
        if (indexA === -1 && indexB === -1) return a.createdAt - b.createdAt;
        if (indexA === -1) return 1;
        if (indexB === -1) return -1;
        return indexA - indexB;
      })
      .map((session) => ({
        sessionId: session.sessionId,
        connectionName: session.connectionName,
        status: session.wsManager.connectionStatus.value, // 从 wsManager 获取状态
        isMarkedForSuspend: session.isMarkedForSuspend,
      }));
  }
  // 如果没有自定义顺序，则按照创建时间排序
  return sessionList
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((session) => ({
      sessionId: session.sessionId,
      connectionName: session.connectionName,
      status: session.wsManager.connectionStatus.value, // 从 wsManager 获取状态
      isMarkedForSuspend: session.isMarkedForSuspend,
    }));
});

export const activeSession = computed((): SessionState | null => {
  if (!activeSessionId.value) return null;
  return sessions.value.get(activeSessionId.value) || null;
});
