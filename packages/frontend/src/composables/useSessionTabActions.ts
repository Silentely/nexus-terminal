import type { ComputedRef } from 'vue';
import type { SessionTabInfoWithStatus } from '../stores/session/types';

/**
 * @interface SessionTabActionsDependencies
 * @description Session 标签页批量操作所需的外部依赖
 */
export interface SessionTabActionsDependencies {
  sessionStore: {
    closeSession: (sessionId: string) => void;
  };
  sessionTabsWithStatus: ComputedRef<SessionTabInfoWithStatus[]>;
}

/**
 * Session 标签页批量关闭操作 composable
 * 从 WorkspaceView.vue 提取的 session 标签页批量操作逻辑
 */
export function useSessionTabActions(deps: SessionTabActionsDependencies) {
  const { sessionStore, sessionTabsWithStatus } = deps;

  /**
   * 关闭目标 session 以外的所有 session
   */
  const handleCloseOtherSessions = (targetSessionId: string) => {
    const targetExists = sessionTabsWithStatus.value.some(
      (tab) => tab.sessionId === targetSessionId,
    );
    if (!targetExists) return;
    const sessionsToClose = sessionTabsWithStatus.value
      .filter((tab) => tab.sessionId !== targetSessionId)
      .map((tab) => tab.sessionId);
    sessionsToClose.forEach((id) => sessionStore.closeSession(id));
  };

  /**
   * 关闭目标 session 右侧的所有 session
   */
  const handleCloseSessionsToRight = (targetSessionId: string) => {
    const targetIndex = sessionTabsWithStatus.value.findIndex(
      (tab) => tab.sessionId === targetSessionId,
    );
    if (targetIndex === -1) return;
    const sessionsToClose = sessionTabsWithStatus.value
      .slice(targetIndex + 1)
      .map((tab) => tab.sessionId);
    sessionsToClose.forEach((id) => sessionStore.closeSession(id));
  };

  /**
   * 关闭目标 session 左侧的所有 session
   */
  const handleCloseSessionsToLeft = (targetSessionId: string) => {
    const targetIndex = sessionTabsWithStatus.value.findIndex(
      (tab) => tab.sessionId === targetSessionId,
    );
    if (targetIndex === -1) return;
    const sessionsToClose = sessionTabsWithStatus.value
      .slice(0, targetIndex)
      .map((tab) => tab.sessionId);
    sessionsToClose.forEach((id) => sessionStore.closeSession(id));
  };

  return {
    handleCloseOtherSessions,
    handleCloseSessionsToRight,
    handleCloseSessionsToLeft,
  };
}
