import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useI18n } from 'vue-i18n';
import { useConnectionsStore, type ConnectionInfo } from '../../connections.store';
import { sessions, activeSessionId } from '../state';
import { generateSessionId } from '../utils';
import type {
  SessionState,
  SshTerminalInstance,
  StatusMonitorInstance,
  DockerManagerInstance,
  SftpManagerInstance,
  WsManagerInstance,
} from '../types';

import { createWebSocketConnectionManager } from '../../../composables/useWebSocketConnection';
import {
  createSshTerminalManager,
  type SshTerminalDependencies,
} from '../../../composables/useSshTerminal';
import {
  createStatusMonitorManager,
  type StatusMonitorDependencies,
} from '../../../composables/useStatusMonitor';
import {
  createDockerManager,
  type DockerManagerDependencies,
} from '../../../composables/useDockerManager';
import { registerSshSuspendHandlers } from './sshSuspendActions';

// --- 辅助函数 (特定于此模块的 actions) ---
const findConnectionInfo = (
  connectionId: number | string,
  connectionsStore: ReturnType<typeof useConnectionsStore>
): ConnectionInfo | undefined => {
  return connectionsStore.connections.find((c) => c.id === Number(connectionId));
};

// --- Actions ---
export const openNewSession = (
  connectionOrId: ConnectionInfo | number | string,
  dependencies: {
    connectionsStore: ReturnType<typeof useConnectionsStore>;
    t: ReturnType<typeof useI18n>['t'];
  },
  existingSessionId?: string // 可选的预定义会话 ID
) => {
  const { connectionsStore, t } = dependencies;
  let connInfo: ConnectionInfo | undefined;
  let connIdForLog: string | number;

  if (typeof connectionOrId === 'object' && connectionOrId !== null && 'id' in connectionOrId) {
    connInfo = connectionOrId as ConnectionInfo;
    connIdForLog = connInfo.id;
  } else {
    connIdForLog = connectionOrId as number | string;
    connInfo = findConnectionInfo(connIdForLog, connectionsStore);
  }

  console.log(
    `[SessionActions] 请求打开新会话: ${connIdForLog}${existingSessionId ? `, 使用预定义 ID: ${existingSessionId}` : ''}`
  );
  if (!connInfo) {
    console.error(`[SessionActions] 无法打开新会话：找不到 ID 为 ${connIdForLog} 的连接信息。`);
    // TODO: 向用户显示错误
    return;
  }

  const newSessionId = existingSessionId || generateSessionId();
  const dbConnId = String(connInfo.id); // connInfo is now guaranteed to be defined here

  // 1. 创建管理器实例
  const isResume = !!existingSessionId; // 如果提供了 existingSessionId，则为恢复流程

  // 稍后创建 wsManager，先创建 SessionState 对象的一部分
  const newSessionPartial: Omit<
    SessionState,
    'wsManager' | 'sftpManagers' | 'terminalManager' | 'statusMonitorManager' | 'dockerManager'
  > & { wsManager?: WsManagerInstance } = {
    sessionId: newSessionId,
    connectionId: dbConnId,
    connectionName: connInfo.name || connInfo.host,
    editorTabs: ref([]),
    activeEditorTabId: ref(null),
    commandInputContent: ref(''),
    isMarkedForSuspend: false,
    createdAt: Date.now(),
    disposables: [],
  };

  const wsManager = createWebSocketConnectionManager(
    newSessionId, // 这个 sessionId 在 wsManager 内部使用，可能与 SessionState.sessionId 不同步（如果后者被后端更新）
    dbConnId,
    t,
    {
      isResumeFlow: isResume,
      getIsMarkedForSuspend: () => {
        return !!newSessionPartial.isMarkedForSuspend;
      },
    }
  );
  newSessionPartial.wsManager = wsManager; // 将 wsManager 添加回部分对象

  const sshTerminalDeps: SshTerminalDependencies = {
    sendMessage: wsManager.sendMessage,
    onMessage: wsManager.onMessage,
    isConnected: wsManager.isConnected,
  };
  const terminalManager = createSshTerminalManager(newSessionId, sshTerminalDeps, t);
  const statusMonitorDeps: StatusMonitorDependencies = {
    onMessage: wsManager.onMessage,
    isConnected: wsManager.isConnected,
  };
  const statusMonitorManager = createStatusMonitorManager(newSessionId, statusMonitorDeps);
  const dockerManagerDeps: DockerManagerDependencies = {
    sendMessage: wsManager.sendMessage,
    onMessage: wsManager.onMessage,
    isConnected: wsManager.isConnected,
  };
  const dockerManager = createDockerManager(newSessionId, dockerManagerDeps, { t });

  // 2. 完成 SessionState 对象
  const newSession: SessionState = {
    ...newSessionPartial, // 包含 sessionId, connectionId, connectionName, wsManager, editorTabs, etc.
    wsManager, // 确保 wsManager 被正确赋值
    sftpManagers: new Map<string, SftpManagerInstance>(),
    terminalManager,
    statusMonitorManager,
    dockerManager,
  };
  // newSession.isMarkedForSuspend 已经在 newSessionPartial 中初始化为 false

  // 3. 添加到 Map 并激活
  const newSessionsMap = new Map(sessions.value);
  newSessionsMap.set(newSessionId, newSession);
  sessions.value = newSessionsMap;
  activeSessionId.value = newSessionId;
  console.log(`[SessionActions] 已创建新会话实例: ${newSessionId} for connection ${dbConnId}`);

  // +++ 在连接前设置 ssh:connected 处理器以更新 sessionId +++
  const originalFrontendSessionIdForHandler = newSessionId; // 捕获初始ID给闭包

  const unregisterConnectedHandler = wsManager.onMessage(
    'ssh:connected',
    (connectedPayload: any) => {
      const backendSID = connectedPayload.sessionId as string;
      const backendCID = String(connectedPayload.connectionId);

      console.log(
        `[SessionActions/ssh:connected] 收到消息。前端初始SID: ${originalFrontendSessionIdForHandler}, 后端SID: ${backendSID}, 后端CID: ${backendCID}`
      );

      const sessionToUpdate = sessions.value.get(originalFrontendSessionIdForHandler);

      if (sessionToUpdate) {
        if (sessionToUpdate.connectionId !== backendCID) {
          console.warn(
            `[SessionActions/ssh:connected] 后端CID ${backendCID} 与会话 ${originalFrontendSessionIdForHandler} 的期望CID ${sessionToUpdate.connectionId} 不匹配。终止SID更新。`
          );
          return;
        }

        if (backendSID && backendSID !== originalFrontendSessionIdForHandler) {
          console.log(
            `[SessionActions/ssh:connected] 会话ID需要更新：从 ${originalFrontendSessionIdForHandler} 到 ${backendSID}。`
          );
          const currentSessions = new Map(sessions.value);
          currentSessions.delete(originalFrontendSessionIdForHandler);

          sessionToUpdate.sessionId = backendSID; // 更新会话对象内部的sessionId

          currentSessions.set(backendSID, sessionToUpdate);
          sessions.value = currentSessions;

          if (activeSessionId.value === originalFrontendSessionIdForHandler) {
            activeSessionId.value = backendSID;
            console.log(`[SessionActions/ssh:connected] 活动会话ID已更新为 ${backendSID}。`);
          }
          console.log(`[SessionActions/ssh:connected] 会话存储已更新，新键为 ${backendSID}。`);
        } else if (backendSID === originalFrontendSessionIdForHandler) {
          console.log(
            `[SessionActions/ssh:connected] 后端SID ${backendSID} 与前端SID匹配。无需重新键控。`
          );
        } else {
          console.error(
            `[SessionActions/ssh:connected] 从后端收到的 ssh:connected 消息中缺少有效的sessionId。Payload:`,
            connectedPayload
          );
        }
      } else {
        console.warn(
          `[SessionActions/ssh:connected] 当处理后端SID ${backendSID} 时，在存储中未找到对应的前端初始SID ${originalFrontendSessionIdForHandler} 的会话。`
        );
      }
      // 此处理器主要用于初始的 sessionId 同步，通常在第一次收到 ssh:connected 后就可以注销，
      // 以避免后续可能的意外重连消息再次触发此逻辑。
      // 但如果 backendID 保证在 ssh:connected 时才首次确定，则保留可能也无害。
      // 为简单起见，暂不在此处自动注销。注销将在 closeSession 中处理。
    }
  );

  if (newSession.disposables) {
    newSession.disposables.push(unregisterConnectedHandler);
  }

  // 4. 启动 WebSocket 连接
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const wsHostAndPort = window.location.host;
  const wsUrl = `${protocol}//${wsHostAndPort}/ws/`;
  console.log(`[SessionActions] Generated WebSocket URL: ${wsUrl}`);
  wsManager.connect(wsUrl);
  console.log(`[SessionActions] 已为会话 ${newSessionId} 启动 WebSocket 连接。`);

  // 注册 SSH 挂起相关的 WebSocket 消息处理器
  // 确保只对 SSH 类型的连接注册 (虽然 wsManager 本身不包含类型信息，但 openNewSession 通常只为 SSH 调用)
  // 如果 connInfo 存在且类型为 SSH，则注册
  if (connInfo && connInfo.type === 'SSH') {
    registerSshSuspendHandlers(wsManager);
    console.log(`[SessionActions] 已为 SSH 会话 ${newSessionId} 注册 SSH 挂起处理器。`);
  } else if (connInfo) {
    console.log(
      `[SessionActions] 会话 ${newSessionId} 类型为 ${connInfo.type}，不注册 SSH 挂起处理器。`
    );
  }
};

export const activateSession = (sessionId: string) => {
  if (sessions.value.has(sessionId)) {
    if (activeSessionId.value !== sessionId) {
      activeSessionId.value = sessionId;
      console.log(`[SessionActions] 已激活会话: ${sessionId}`);
    } else {
      console.log(`[SessionActions] 会话 ${sessionId} 已经是活动状态。`);
    }
  } else {
    console.warn(`[SessionActions] 尝试激活不存在的会话 ID: ${sessionId}`);
  }
};

export const closeSession = (sessionId: string) => {
  console.log(`[SessionActions] 请求关闭会话 ID: ${sessionId}`);
  const sessionToClose = sessions.value.get(sessionId);
  if (!sessionToClose) {
    console.warn(`[SessionActions] 尝试关闭不存在的会话 ID: ${sessionId}`);
    return;
  }

  // 1. 调用实例上的清理和断开方法
  sessionToClose.wsManager.disconnect();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 wsManager.disconnect()`);
  sessionToClose.sftpManagers.forEach((manager, instanceId) => {
    manager.cleanup();
    console.log(
      `[SessionActions] 已为会话 ${sessionId} 的 sftpManager (实例 ${instanceId}) 调用 cleanup()`
    );
  });
  sessionToClose.sftpManagers.clear();
  sessionToClose.terminalManager.cleanup();
  // 调用存储在会话中的所有清理函数
  if (sessionToClose.disposables && Array.isArray(sessionToClose.disposables)) {
    sessionToClose.disposables.forEach((dispose) => {
      try {
        dispose();
      } catch (e) {
        console.error(`[SessionActions] 清理disposable时出错:`, e);
      }
    });
    sessionToClose.disposables = []; // 清空数组
    console.log(`[SessionActions] 已为会话 ${sessionId} 调用所有disposables。`);
  }
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 terminalManager.cleanup()`);
  sessionToClose.statusMonitorManager.cleanup();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 statusMonitorManager.cleanup()`);
  sessionToClose.dockerManager.cleanup();
  console.log(`[SessionActions] 已为会话 ${sessionId} 调用 dockerManager.cleanup()`);

  // 2. 从 Map 中移除会话
  const newSessionsMap = new Map(sessions.value);
  newSessionsMap.delete(sessionId);
  sessions.value = newSessionsMap;
  console.log(`[SessionActions] 已从 Map 中移除会话: ${sessionId}`);

  // 3. 切换活动标签页
  if (activeSessionId.value === sessionId) {
    const remainingSessions = Array.from(sessions.value.keys());
    const nextActiveId =
      remainingSessions.length > 0 ? remainingSessions[remainingSessions.length - 1] : null;
    activeSessionId.value = nextActiveId;
    console.log(`[SessionActions] 关闭活动会话后，切换到: ${nextActiveId}`);
  }
};

export const handleConnectRequest = (
  connection: ConnectionInfo,
  dependencies: {
    connectionsStore: ReturnType<typeof useConnectionsStore>;
    router: ReturnType<typeof useRouter>;
    openRdpModalAction: (connection: ConnectionInfo) => void; // 来自 modalActions
    openVncModalAction: (connection: ConnectionInfo) => void; // 来自 modalActions
    t: ReturnType<typeof useI18n>['t'];
  }
) => {
  const { connectionsStore, router, openRdpModalAction, openVncModalAction, t } = dependencies;

  if (connection.type === 'RDP') {
    openRdpModalAction(connection);
  } else if (connection.type === 'VNC') {
    openVncModalAction(connection);
  } else {
    const connIdStr = String(connection.id);
    let activeAndDisconnected = false;

    if (activeSessionId.value) {
      const currentActiveSession = sessions.value.get(activeSessionId.value);
      if (currentActiveSession && currentActiveSession.connectionId === connIdStr) {
        const currentStatus = currentActiveSession.wsManager.connectionStatus.value;
        console.log(
          `[SessionActions] 点击的是当前活动会话 ${activeSessionId.value}，状态: ${currentStatus}`
        );
        if (currentStatus === 'disconnected' || currentStatus === 'error') {
          activeAndDisconnected = true;
          console.log(
            `[SessionActions] 活动会话 ${activeSessionId.value} 已断开或出错，尝试重连...`
          );
          const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
          const wsHostAndPort = window.location.host;
          const wsUrl = `${protocol}//${wsHostAndPort}/ws/`;
          console.log(
            `[SessionActions handleConnectRequest] Generated WebSocket URL for reconnect: ${wsUrl}`
          );
          currentActiveSession.wsManager.connect(wsUrl);
          activateSession(activeSessionId.value);
          router.push({ name: 'Workspace' });
        }
      }
    }

    if (!activeAndDisconnected) {
      console.log(
        `[SessionActions] 不满足重连条件或点击了其他连接，将打开新会话 for ID: ${connIdStr}`
      );
      openNewSession(connIdStr, { connectionsStore, t });
      router.push({ name: 'Workspace' });
    }
  }
};

export const handleOpenNewSession = (
  connectionId: number | string,
  dependencies: {
    connectionsStore: ReturnType<typeof useConnectionsStore>;
    t: ReturnType<typeof useI18n>['t'];
  }
) => {
  console.log(`[SessionActions] handleOpenNewSession called for ID: ${connectionId}`);
  openNewSession(connectionId, dependencies); // existingSessionId 将为 undefined，因此会生成新的
};

export const cleanupAllSessions = () => {
  console.log('[SessionActions] 清理所有会话...');
  sessions.value.forEach((_session, sessionId) => {
    closeSession(sessionId);
  });
  // sessions.value.clear(); // closeSession 内部会逐个删除，这里不需要重复clear，但确认Map为空
  if (sessions.value.size > 0) {
    // 以防万一
    const newSessionsMap = new Map(sessions.value);
    newSessionsMap.clear();
    sessions.value = newSessionsMap;
  }
  activeSessionId.value = null;
};
