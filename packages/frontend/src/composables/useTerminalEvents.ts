import { type Ref } from 'vue';
import type { Terminal as XtermTerminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import type { SshTerminalInstance, SessionState } from '../stores/session/types';
import type { ConnectionInfo } from '../stores/connections.store';
import { log } from '@/utils/log';

/**
 * @interface TerminalEventsDependencies
 * @description 终端事件处理所需的外部依赖
 */
export interface TerminalEventsDependencies {
  sessionStore: {
    sessions: Map<string, SessionState>;
    handleConnectRequest: (info: ConnectionInfo) => void;
  };
  connectionsStore: {
    connections: ConnectionInfo[];
  };
  commandHistoryStore: {
    addCommand: (command: string) => void;
  };
  activeSession: Ref<SessionState | null>;
  activeSessionId: Ref<string | null>;
  isMobile: Ref<boolean>;
  t: (key: string, fallback?: string) => string;
}

/**
 * 终端事件处理 composable
 * 从 WorkspaceView.vue 提取的终端相关事件处理逻辑
 */
export function useTerminalEvents(deps: TerminalEventsDependencies) {
  const {
    sessionStore,
    connectionsStore,
    commandHistoryStore,
    activeSession,
    activeSessionId,
    isMobile,
    t,
  } = deps;

  /**
   * 处理命令发送（用于 CommandBar、CommandHistory、QuickCommands）
   */
  const handleSendCommand = (command: string, targetSessionId?: string) => {
    const sessionToCommand = targetSessionId
      ? sessionStore.sessions.get(targetSessionId)
      : activeSession.value;

    if (!sessionToCommand) {
      const idForLog = targetSessionId || 'active (none found)';
      log.warn(`[useTerminalEvents] Cannot send command, no session found for ID: ${idForLog}.`);
      return;
    }
    const terminalManager = sessionToCommand.terminalManager as SshTerminalInstance | undefined;

    if (
      terminalManager?.isSshConnected &&
      !terminalManager.isSshConnected.value &&
      command.trim() === ''
    ) {
      log.info(
        `[useTerminalEvents] Command bar Enter detected in disconnected session ${sessionToCommand.sessionId}, attempting reconnect...`,
      );
      if (terminalManager.terminalInstance?.value) {
        terminalManager.terminalInstance.value.writeln(
          `\r\n\x1b[33m${t('workspace.terminal.reconnectingMsg')}\x1b[0m`,
        );
      }
      const connectionInfo = connectionsStore.connections.find(
        (c) => c.id === Number(sessionToCommand.connectionId),
      );
      if (connectionInfo) {
        sessionStore.handleConnectRequest(connectionInfo);
      } else {
        log.error(
          `[useTerminalEvents] handleSendCommand: 未找到 ID 为 ${sessionToCommand.connectionId} 的连接信息。`,
        );
      }
      return;
    }

    if (terminalManager && typeof terminalManager.sendData === 'function') {
      const commandToSend = command.trim();
      log.info(
        `[useTerminalEvents] Sending command/data to session ${sessionToCommand.sessionId}: ${JSON.stringify(command)}`,
      );
      const dataToSend = command === '\x03' ? command : command + '\r';
      terminalManager.sendData(dataToSend);

      if (
        commandToSend.length > 0 &&
        command !== '\x03' &&
        sessionToCommand.sessionId === activeSessionId.value
      ) {
        commandHistoryStore.addCommand(commandToSend);
      }
    } else {
      log.warn(
        `[useTerminalEvents] Cannot send command for session ${sessionToCommand.sessionId}, terminal manager or sendData method not available.`,
      );
    }
  };

  /**
   * 处理终端输入（用于 Terminal）
   */
  const handleTerminalInput = (payload: { sessionId: string; data: string }) => {
    const { sessionId, data } = payload;
    const session = sessionStore.sessions.get(sessionId);
    const manager = session?.terminalManager as SshTerminalInstance | undefined;
    if (!session || !manager) {
      log.warn(
        `[useTerminalEvents] handleTerminalInput: 未找到会话 ${sessionId} 或其 terminalManager`,
      );
      return;
    }
    if (data === '\r' && manager.isSshConnected && !manager.isSshConnected.value) {
      log.info(`[useTerminalEvents] 检测到在断开的会话 ${sessionId} 中按下回车，尝试重连...`);
      if (manager.terminalInstance?.value) {
        manager.terminalInstance.value.writeln(
          `\r\n\x1b[33m${t('workspace.terminal.reconnectingMsg')}\x1b[0m`,
        );
      } else {
        log.warn(`[useTerminalEvents] 无法写入重连提示，terminalInstance 不可用。`);
      }
      const connectionInfo = connectionsStore.connections.find(
        (c) => c.id === Number(session.connectionId),
      );
      if (connectionInfo) {
        sessionStore.handleConnectRequest(connectionInfo);
      } else {
        log.error(
          `[useTerminalEvents] handleTerminalInput: 未找到 ID 为 ${session.connectionId} 的连接信息。`,
        );
      }
    } else {
      manager.handleTerminalData(data);
    }
  };

  /**
   * 处理终端大小调整（用于 Terminal）
   */
  const handleTerminalResize = (payload: {
    sessionId: string;
    dims: { cols: number; rows: number };
  }) => {
    sessionStore.sessions
      .get(payload.sessionId)
      ?.terminalManager.handleTerminalResize(payload.dims);
  };

  /**
   * 处理终端就绪（用于 Terminal）
   */
  const handleTerminalReady = (payload: {
    sessionId: string;
    terminal: XtermTerminal;
    searchAddon: SearchAddon | null;
  }) => {
    log.info(
      `[useTerminalEvents ${payload.sessionId}] 收到 terminal-ready 事件。Payload:`,
      payload,
    );
    if (payload && payload.searchAddon) {
      log.info(`[useTerminalEvents ${payload.sessionId}] Payload 包含 searchAddon 实例。`);
    } else {
      log.warn(
        `[useTerminalEvents ${payload.sessionId}] Payload 未包含 searchAddon 实例！ Payload:`,
        payload,
      );
    }
    sessionStore.sessions.get(payload.sessionId)?.terminalManager.handleTerminalReady(payload);
  };

  /**
   * 处理清空终端事件
   */
  const handleClearTerminal = () => {
    const currentSession = activeSession.value;
    if (!currentSession) {
      log.warn('[useTerminalEvents] Cannot clear terminal, no active session.');
      return;
    }
    const terminalManager = currentSession.terminalManager as SshTerminalInstance | undefined;
    const mode = isMobile.value ? 'Mobile' : 'Desktop';

    if (
      terminalManager &&
      terminalManager.terminalInstance?.value &&
      typeof terminalManager.terminalInstance.value.clear === 'function'
    ) {
      log.info(
        `[useTerminalEvents ${mode}] Clearing terminal for active session ${currentSession.sessionId}`,
      );
      terminalManager.terminalInstance.value.clear();
    } else {
      log.warn(
        `[useTerminalEvents ${mode}] Cannot clear terminal for session ${currentSession.sessionId}, terminal manager, instance, or clear method not available.`,
      );
    }
  };

  /**
   * 处理滚动到底部请求
   */
  const handleScrollToBottomRequest = (payload: { sessionId: string }) => {
    const session = sessionStore.sessions.get(payload.sessionId);
    const terminalManager = session?.terminalManager as SshTerminalInstance | undefined;
    if (terminalManager?.terminalInstance?.value) {
      log.info(`[useTerminalEvents] Scrolling to bottom for session ${payload.sessionId}`);
      terminalManager.terminalInstance.value.scrollToBottom();
    } else {
      log.warn(
        `[useTerminalEvents] Cannot scroll to bottom for session ${payload.sessionId}, terminal instance not found.`,
      );
    }
  };

  /**
   * 处理虚拟键盘按键事件
   */
  const handleVirtualKeyPress = (keySequence: string) => {
    const currentSession = activeSession.value;
    if (!currentSession) {
      log.warn('[useTerminalEvents] Cannot send virtual key, no active session.');
      return;
    }
    const terminalManager = currentSession.terminalManager as SshTerminalInstance | undefined;
    if (terminalManager && typeof terminalManager.sendData === 'function') {
      log.info(
        `[useTerminalEvents Mobile] Sending virtual key sequence: ${JSON.stringify(keySequence)}`,
      );
      terminalManager.sendData(keySequence);
    } else {
      log.warn(
        `[useTerminalEvents Mobile] Cannot send virtual key for session ${currentSession.sessionId}, terminal manager or sendData method not available.`,
      );
    }
  };

  /**
   * 处理 quickCommand:executeProcessed 事件
   */
  const handleQuickCommandExecuteProcessed = (payload: { command: string; sessionId?: string }) => {
    const { command, sessionId: targetSessionId } = payload;
    log.info(
      `[useTerminalEvents] Received quickCommand:executeProcessed event. Command: "${command}", TargetSessionID: ${targetSessionId}`,
    );
    handleSendCommand(command, targetSessionId);
  };

  return {
    handleSendCommand,
    handleTerminalInput,
    handleTerminalResize,
    handleTerminalReady,
    handleClearTerminal,
    handleScrollToBottomRequest,
    handleVirtualKeyPress,
    handleQuickCommandExecuteProcessed,
  };
}
