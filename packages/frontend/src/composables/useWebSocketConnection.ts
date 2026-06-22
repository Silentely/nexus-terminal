/**
 * WebSocket 连接管理器
 * 负责创建和管理单个 WebSocket 连接实例，每个实例对应一个会话
 *
 * 子模块：
 * - useWebSocketConnection/messageParser.ts - 消息解析与验证
 * - useWebSocketConnection/reconnect.ts - 重连逻辑与策略
 */

import { ref, shallowRef, computed, readonly } from 'vue';
import { useI18n } from 'vue-i18n';
import type {
  ConnectionStatus as WsConnectionStatusType,
  MessagePayload,
  WebSocketMessage,
  MessageHandler,
} from '../types/websocket.types';
import { parseWebSocketMessage } from './useWebSocketConnection/messageParser';
import { createReconnectManager } from './useWebSocketConnection/reconnect';
import { log } from '@/utils/log';

// 导出类型别名，以便其他模块可以使用
export type WsConnectionStatus = WsConnectionStatusType;

/**
 * 创建并管理单个 WebSocket 连接实例。
 * 每个实例对应一个会话 (Session)。
 *
 * @param sessionId - 此 WebSocket 连接关联的会话 ID (用于日志记录)
 * @param dbConnectionId - 此 WebSocket 连接关联的数据库连接 ID (用于后端识别)
 * @param t - i18n 翻译函数，从父组件传入
 * @param options - 可选参数对象
 * @returns 一个包含状态和方法的 WebSocket 连接管理器对象
 */
export function createWebSocketConnectionManager(
  sessionId: string,
  dbConnectionId: string,
  t: ReturnType<typeof useI18n>['t'],
  options?: {
    isResumeFlow?: boolean;
    getIsMarkedForSuspend?: () => boolean;
    transport?: {
      sid: string;
      sendMessage: (message: WebSocketMessage) => void;
      onMessage: (type: string, handler: MessageHandler) => () => void;
      connect: () => void;
      disconnect: () => void;
    };
  },
) {
  // --- 实例状态 ---
  const ws = shallowRef<WebSocket | null>(null);
  const isResumeFlow = options?.isResumeFlow ?? false;
  const connectionStatus = ref<WsConnectionStatus>('disconnected');
  const statusMessage = ref<string>('');
  const isSftpReady = ref<boolean>(false);
  const messageHandlers = new Map<string, Set<MessageHandler>>();
  const instanceSessionId = sessionId;
  const instanceDbConnectionId = dbConnectionId;
  const getIsMarkedForSuspend = options?.getIsMarkedForSuspend;
  const transport = options?.transport;

  // --- 重连管理器（从 reconnect.ts 提取） ---
  const reconnectManager = createReconnectManager({ maxAttempts: 5 });

  /**
   * 安全地获取状态文本的辅助函数
   */
  const getStatusText = (statusKey: string, params?: Record<string, unknown>): string => {
    try {
      const translated = t(`workspace.status.${statusKey}`, params || {});
      return translated === `workspace.status.${statusKey}` ? statusKey : translated;
    } catch (error: unknown) {
      log.warn(
        `[WebSocket ${instanceSessionId}] i18n 错误 (键: workspace.status.${statusKey}):`,
        error,
      );
      return statusKey;
    }
  };

  /**
   * 将收到的消息分发给已注册的处理器
   */
  const dispatchMessage = (
    type: string,
    payload: MessagePayload,
    fullMessage: WebSocketMessage,
  ) => {
    if (messageHandlers.has(type)) {
      messageHandlers.get(type)?.forEach((handler) => {
        try {
          handler(payload, fullMessage);
        } catch (error: unknown) {
          log.error(`[WebSocket ${instanceSessionId}] 消息处理器错误 (类型: "${type}"):`, error);
        }
      });
    }
  };

  /**
   * 安排重连（使用 reconnect 模块的原语）
   */
  const scheduleReconnect = () => {
    if (!reconnectManager.shouldReconnect()) {
      statusMessage.value = getStatusText('reconnectFailed');
      return;
    }
    const isSuspendMarked = getIsMarkedForSuspend?.();
    if (isSuspendMarked) return;
    const delay = reconnectManager.getBackoffDelay(reconnectManager.incrementAttempts());
    statusMessage.value = getStatusText('reconnecting', {
      attempt: reconnectManager.state.attempts,
    });
    reconnectManager.scheduleTimer(() => connect(reconnectManager.state.lastUrl), delay);
  };

  /**
   * 建立 WebSocket 连接
   */
  const connect = (url: string) => {
    reconnectManager.state.lastUrl = url;
    reconnectManager.state.intentionalDisconnect = false;
    reconnectManager.clearTimer();

    // 多路复用模式：委托给 transport，并同步状态
    if (transport) {
      statusMessage.value = getStatusText('connectingWs', { url });
      connectionStatus.value = 'connecting';
      isSftpReady.value = false;
      // 注册消息处理器，同步 transport 状态到 manager
      transport.onMessage('ssh:connected', () => {
        connectionStatus.value = 'connected';
        statusMessage.value = getStatusText('connected');
      });
      transport.onMessage('ssh:disconnected', (payload) => {
        connectionStatus.value = 'disconnected';
        statusMessage.value = getStatusText('disconnected', {
          reason: typeof payload === 'string' ? payload : '未知原因',
        });
        isSftpReady.value = false;
      });
      transport.onMessage('ssh:error', (payload) => {
        connectionStatus.value = 'error';
        const errorMsg = typeof payload === 'string' ? payload : '错误';
        statusMessage.value = getStatusText('error', { message: errorMsg });
        isSftpReady.value = false;
      });
      transport.onMessage('sftp_ready', () => {
        isSftpReady.value = true;
      });
      transport.connect();
      return;
    }

    // 阻止重复连接
    if (
      ws.value &&
      (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING) &&
      (connectionStatus.value === 'connected' || connectionStatus.value === 'connecting')
    ) {
      log.warn(
        `[WebSocket ${instanceSessionId}] 连接已打开或正在连接中 (readyState: ${ws.value.readyState}, status: ${connectionStatus.value})。 阻止重复连接。`,
      );
      return;
    }

    // 处理状态不一致或旧连接未完全关闭
    if (
      ws.value &&
      (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)
    ) {
      log.warn(
        `[WebSocket ${instanceSessionId}] 检测到状态不一致 (readyState: ${ws.value.readyState}, status: ${connectionStatus.value})。尝试关闭旧连接并继续...`,
      );
      const oldWs = ws.value;
      const previousIntentionalDisconnect = reconnectManager.state.intentionalDisconnect;
      reconnectManager.state.intentionalDisconnect = true;
      if (oldWs) {
        oldWs.onopen = null;
        oldWs.onmessage = null;
        oldWs.onerror = null;
        oldWs.onclose = null;
        oldWs.close(1000, '状态不一致，强制重连');
      }
      ws.value = null;
      reconnectManager.state.intentionalDisconnect = previousIntentionalDisconnect;
    } else if (ws.value && ws.value.readyState === WebSocket.CLOSING) {
      ws.value = null;
    }

    statusMessage.value = getStatusText('connectingWs', { url });
    connectionStatus.value = 'connecting';
    isSftpReady.value = false;

    try {
      // 根据页面协议调整 WebSocket URL
      let secureUrl = url;
      if (window.location.protocol === 'https:') {
        secureUrl = url.replace(/^ws:/, 'wss:');
      }
      ws.value = new WebSocket(secureUrl);

      ws.value.onopen = () => {
        reconnectManager.reset();
        statusMessage.value = getStatusText('wsConnected');
        if (!isResumeFlow) {
          sendMessage({
            type: 'ssh:connect',
            payload: { connectionId: parseInt(instanceDbConnectionId, 10) },
          });
        } else {
          connectionStatus.value = 'connected';
        }
        dispatchMessage('internal:opened', {}, { type: 'internal:opened' });
      };

      ws.value.onmessage = (event: MessageEvent) => {
        // 使用 messageParser 模块解析和验证消息（从 messageParser.ts 提取）
        const message = parseWebSocketMessage(event.data);
        if (!message) {
          dispatchMessage('internal:raw', event.data, { type: 'internal:raw' });
          return;
        }

        // 根据消息类型更新连接状态
        if (message.type === 'ssh:connected') {
          if (connectionStatus.value !== 'connected') {
            connectionStatus.value = 'connected';
            statusMessage.value = getStatusText('connected');
          }
        } else if (message.type === 'ssh:disconnected') {
          if (connectionStatus.value !== 'disconnected') {
            connectionStatus.value = 'disconnected';
            statusMessage.value = getStatusText('disconnected', {
              reason: message.payload || '未知原因',
            });
            isSftpReady.value = false;
          }
        } else if (
          message.type === 'ssh:error' ||
          message.type === 'error' ||
          message.type === 'sftp_error' ||
          message.type === 'rdp:error'
        ) {
          if (connectionStatus.value !== 'disconnected' && connectionStatus.value !== 'error') {
            connectionStatus.value = 'error';
            let errorMsg: string | unknown = message.payload || '未知错误';
            if (typeof errorMsg === 'object' && errorMsg !== null && 'message' in errorMsg) {
              errorMsg = (errorMsg as Record<string, unknown>).message as string;
            }
            statusMessage.value = getStatusText('error', { message: errorMsg });
            isSftpReady.value = false;
          }
        } else if (message.type === 'sftp_ready') {
          isSftpReady.value = true;
        }

        dispatchMessage(message.type, message.payload, message);
      };

      ws.value.onerror = () => {
        if (connectionStatus.value !== 'disconnected' && connectionStatus.value !== 'error') {
          connectionStatus.value = 'error';
          statusMessage.value = getStatusText('wsError');
        }
        dispatchMessage('internal:error', {}, { type: 'internal:error' });
        isSftpReady.value = false;
        ws.value = null;
        if (!reconnectManager.state.intentionalDisconnect) {
          scheduleReconnect();
        }
      };

      ws.value.onclose = (event) => {
        if (connectionStatus.value !== 'error' && connectionStatus.value !== 'disconnected') {
          connectionStatus.value = 'disconnected';
          if (!reconnectManager.state.intentionalDisconnect && event.code !== 1000) {
            statusMessage.value = getStatusText('wsClosedWillRetry', { code: event.code });
          } else {
            statusMessage.value = getStatusText('wsClosed', { code: event.code });
          }
        }
        dispatchMessage(
          'internal:closed',
          { code: event.code, reason: event.reason },
          { type: 'internal:closed' },
        );
        isSftpReady.value = false;
        ws.value = null;
        if (!reconnectManager.state.intentionalDisconnect && event.code !== 1000) {
          scheduleReconnect();
        }
      };
    } catch {
      connectionStatus.value = 'error';
      statusMessage.value = getStatusText('wsError');
      isSftpReady.value = false;
      ws.value = null;
    }
  };

  /**
   * 手动断开此 WebSocket 连接
   */
  const disconnect = () => {
    reconnectManager.state.intentionalDisconnect = true;
    reconnectManager.clearTimer();

    // 多路复用模式：委托给 transport
    if (transport) {
      if (connectionStatus.value !== 'disconnected') {
        connectionStatus.value = 'disconnected';
        statusMessage.value = getStatusText('disconnected', { reason: '手动断开' });
      }
      transport.disconnect();
      isSftpReady.value = false;
      return;
    }

    if (ws.value) {
      if (connectionStatus.value !== 'disconnected') {
        connectionStatus.value = 'disconnected';
        statusMessage.value = getStatusText('disconnected', { reason: '手动断开' });
      }
      ws.value.close(1000, '客户端主动断开');
      ws.value = null;
      isSftpReady.value = false;
    }
  };

  /**
   * 发送 WebSocket 消息
   */
  const sendMessage = (message: WebSocketMessage) => {
    // 多路复用模式：委托给 transport
    if (transport) {
      try {
        transport.sendMessage(message);
      } catch (error: unknown) {
        log.error(`[WebSocket ${instanceSessionId}] 多路复用发送消息失败:`, error, message);
      }
      return;
    }

    if (ws.value && ws.value.readyState === WebSocket.OPEN) {
      try {
        const messageString = JSON.stringify(message);
        ws.value.send(messageString);
      } catch (error: unknown) {
        log.error(`[WebSocket ${instanceSessionId}] 序列化或发送消息失败:`, error, message);
      }
    } else {
      log.warn(
        `[WebSocket ${instanceSessionId}] 无法发送消息，连接未打开。状态: ${connectionStatus.value}, ReadyState: ${ws.value?.readyState}`,
      );
    }
  };

  /**
   * 注册一个消息处理器
   * @returns 用于注销此处理器的函数
   */
  const onMessage = (type: string, handler: MessageHandler): (() => void) => {
    // 多路复用模式：委托给 transport
    if (transport) {
      return transport.onMessage(type, handler);
    }

    if (!messageHandlers.has(type)) {
      messageHandlers.set(type, new Set());
    }
    const handlersSet = messageHandlers.get(type);
    if (handlersSet) {
      handlersSet.add(handler);
    }

    return () => {
      const currentSet = messageHandlers.get(type);
      if (currentSet) {
        currentSet.delete(handler);
        if (currentSet.size === 0) {
          messageHandlers.delete(type);
        }
      }
    };
  };

  return {
    // 状态 (只读引用)
    isConnected: computed(() => connectionStatus.value === 'connected'),
    isSftpReady: readonly(isSftpReady),
    connectionStatus: readonly(connectionStatus),
    statusMessage: readonly(statusMessage),

    // 方法
    connect,
    disconnect,
    sendMessage,
    onMessage,
  };
}
