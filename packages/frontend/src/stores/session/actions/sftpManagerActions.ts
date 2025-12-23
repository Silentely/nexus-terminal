// packages/frontend/src/stores/session/actions/sftpManagerActions.ts

import { ref } from 'vue';
import type { useI18n } from 'vue-i18n';
import { sessions } from '../state';
import type { SftpManagerInstance } from '../types';
import {
  createSftpActionsManager,
  type WebSocketDependencies,
} from '../../../composables/useSftpActions'; // 路径: packages/frontend/src/composables/useSftpActions.ts

export const getOrCreateSftpManager = (
  sessionId: string,
  instanceId: string,
  dependencies: {
    t: ReturnType<typeof useI18n>['t'];
  }
): SftpManagerInstance | null => {
  const session = sessions.value.get(sessionId);
  if (!session) {
    console.error(`[SftpManagerActions] 尝试为不存在的会话 ${sessionId} 获取 SFTP 管理器`);
    return null;
  }
  const { t } = dependencies;

  let manager = session.sftpManagers.get(instanceId);
  if (!manager) {
    console.log(`[SftpManagerActions] 为会话 ${sessionId} 创建新的 SFTP 管理器实例: ${instanceId}`);
    const currentSftpPath = ref<string>('.'); // 每个实例有自己的路径
    const wsDeps: WebSocketDependencies = {
      sendMessage: session.wsManager.sendMessage,
      onMessage: session.wsManager.onMessage,
      isConnected: session.wsManager.isConnected,
      isSftpReady: session.wsManager.isSftpReady,
    };
    manager = createSftpActionsManager(sessionId, currentSftpPath, wsDeps, t);
    session.sftpManagers.set(instanceId, manager);
  }
  return manager;
};

export const removeSftpManager = (sessionId: string, instanceId: string) => {
  const session = sessions.value.get(sessionId);
  if (session) {
    const manager = session.sftpManagers.get(instanceId);
    if (manager) {
      manager.cleanup();
      session.sftpManagers.delete(instanceId);
      console.log(
        `[SftpManagerActions] 已移除并清理会话 ${sessionId} 的 SFTP 管理器实例: ${instanceId}`
      );
    }
  }
};
