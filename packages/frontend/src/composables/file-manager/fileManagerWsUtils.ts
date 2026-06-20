/**
 * 文件管理器 WebSocket 依赖获取工具
 * 从 sessionStore 动态获取当前会话的 WebSocket 依赖，
 * 避免 wsDeps 闭包陈旧问题（组件复用时 props.wsDeps 不会更新）
 */

import type { WebSocketDependencies } from '../../composables/useSftpActions';
import type { useSessionStore } from '../../stores/session.store';

type SessionStore = ReturnType<typeof useSessionStore>;

/**
 * 从 sessionStore 动态获取当前会话的 WebSocket 依赖
 * @returns 当前会话的 WebSocket 依赖，若会话不存在则返回 null
 */
export const getWsDepsFromSession = (
  sessionStore: SessionStore,
  sessionId: string,
): WebSocketDependencies | null => {
  const session = sessionStore.sessions.get(sessionId);
  if (!session?.wsManager) return null;
  return {
    sendMessage: session.wsManager.sendMessage,
    onMessage: session.wsManager.onMessage,
    isConnected: session.wsManager.isConnected,
    isSftpReady: session.wsManager.isSftpReady,
  };
};
