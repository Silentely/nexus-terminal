/**
 * WebSocket 多路复用传输层（前端）
 * 单例模式管理共享 WebSocket 连接，支持多个逻辑通道
 *
 * 设计思路：
 * - 单例模式：全局共享一个物理 WebSocket 连接
 * - 逻辑通道：每个 SSH 会话对应一个逻辑通道
 * - 自动重连：物理连接断开时自动重连，重连后重建所有活跃通道
 * - 通道隔离：每个通道独立维护连接状态和消息处理
 */

import { ref, readonly, type Ref } from 'vue';
import type { ConnectionStatus, WebSocketMessage, MessagePayload } from '../types/websocket.types';
import { parseWebSocketMessage } from './useWebSocketConnection/messageParser';
import { createReconnectManager } from './useWebSocketConnection/reconnect';
import { log } from '@/utils/log';
import { useAuthStore } from '../stores/auth.store';

/**
 * 检查前端多路复用是否启用
 * 从后端 /auth/init 接口读取配置（后端 ENABLE_MULTIPLEX 环境变量控制），无需前端构建时变量
 */
export function isMultiplexEnabled(): boolean {
  try {
    return useAuthStore().multiplexEnabled;
  } catch {
    return false;
  }
}

/** 逻辑通道状态（使用 Ref 实现响应式） */
export interface ChannelState {
  sid: string;
  dbConnectionId: string;
  connectionStatus: Ref<ConnectionStatus>;
  statusMessage: Ref<string>;
  isSftpReady: Ref<boolean>;
  messageHandlers: Map<string, Set<(payload: MessagePayload, message: WebSocketMessage) => void>>;
  isResumeFlow: boolean;
}

/** 通道控制接口 */
export interface MultiplexChannel {
  readonly sid: string;
  connectionStatus: Readonly<Ref<ConnectionStatus>>;
  statusMessage: Readonly<Ref<string>>;
  isSftpReady: Readonly<Ref<boolean>>;
  connect: () => void;
  disconnect: () => void;
  sendMessage: (message: WebSocketMessage) => boolean;
  onMessage: (
    type: string,
    handler: (payload: MessagePayload, message: WebSocketMessage) => void,
  ) => () => void;
}

/** 传输层状态 */
const ws = ref<WebSocket | null>(null);
const isConnecting = ref(false);
const channels = new Map<string, ChannelState>();
const reconnectManager = createReconnectManager({ maxAttempts: 5 });

/**
 * 构建 WebSocket URL
 */
function buildWsUrl(): string {
  const protocol = globalThis.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = globalThis.location.host;
  return `${protocol}//${host}/ws/`;
}

/**
 * 向物理连接发送消息
 */
function sendRawMessage(message: object): boolean {
  if (ws.value?.readyState === WebSocket.OPEN) {
    try {
      ws.value.send(JSON.stringify(message));
      return true;
    } catch (error) {
      log.error('[MultiplexTransport] 发送消息失败:', error);
      return false;
    }
  }
  log.warn('[MultiplexTransport] 无法发送消息，物理连接未打开');
  return false;
}

/**
 * 向指定通道发送消息
 */
function sendToChannel(sid: string, message: WebSocketMessage): boolean {
  const messageWithSid = { ...message, sid };
  return sendRawMessage(messageWithSid);
}

/**
 * 分发消息到对应通道
 */
function dispatchToChannel(message: WebSocketMessage): void {
  // 提取消息中的 sid（服务端响应会携带 sid）
  const sid = (message as Record<string, unknown>).sid as string | undefined;
  if (!sid) {
    log.warn('[MultiplexTransport] 收到无 sid 的消息，忽略');
    return;
  }

  const channel = channels.get(sid);
  if (!channel) {
    log.warn(`[MultiplexTransport] 收到未知通道 ${sid} 的消息`);
    return;
  }

  // 更新通道状态（通过 Ref 响应式更新）
  if (message.type === 'ssh:connected') {
    channel.connectionStatus.value = 'connected';
    channel.statusMessage.value = '已连接';
    // 重置 SFTP 就绪状态：新会话的 SFTP 尚未初始化，需等待 sftp_ready 消息
    channel.isSftpReady.value = false;
    // 多路复用握手：后端返回 backendSessionId，需要重映射通道 key
    const payload = message.payload as Record<string, unknown> | undefined;
    const backendSessionId = payload?.backendSessionId as string | undefined;
    if (backendSessionId && backendSessionId !== sid) {
      const existing = channels.get(backendSessionId);
      if (existing && existing !== channel) {
        log.error(`[MultiplexTransport] 重映射冲突，目标通道已存在: ${backendSessionId}`);
        return;
      }
      log.info(`[MultiplexTransport] 通道重映射: ${sid} → ${backendSessionId}`);
      channels.set(backendSessionId, channel);
      channel.sid = backendSessionId;
      channels.delete(sid);
    }
  } else if (message.type === 'ssh:disconnected') {
    channel.connectionStatus.value = 'disconnected';
    channel.statusMessage.value = typeof message.payload === 'string' ? message.payload : '已断开';
    channel.isSftpReady.value = false;
  } else if (message.type === 'ssh:error' || message.type === 'error') {
    channel.connectionStatus.value = 'error';
    channel.statusMessage.value = typeof message.payload === 'string' ? message.payload : '错误';
    channel.isSftpReady.value = false;
  } else if (message.type === 'sftp_ready') {
    channel.isSftpReady.value = true;
  }

  // 分发到注册的处理器
  const handlers = channel.messageHandlers.get(message.type);
  if (handlers) {
    handlers.forEach((handler) => {
      try {
        handler(message.payload, message);
      } catch (error) {
        log.error(`[MultiplexTransport] 通道 ${sid} 消息处理器错误:`, error);
      }
    });
  }
}

/**
 * 向通道发送 ssh:connect 请求
 */
function sendConnectToChannel(channel: ChannelState): void {
  if (!channel.isResumeFlow) {
    sendToChannel(channel.sid, {
      type: 'ssh:connect',
      payload: { connectionId: Number.parseInt(channel.dbConnectionId, 10) },
    });
  } else {
    // 直接通过 Ref 更新状态
    const ch = channels.get(channel.sid);
    if (ch) {
      ch.connectionStatus.value = 'connected';
    }
  }
}

/**
 * 建立物理连接
 */
function connectPhysical(): void {
  if (
    ws.value &&
    (ws.value.readyState === WebSocket.OPEN || ws.value.readyState === WebSocket.CONNECTING)
  ) {
    return;
  }

  const url = buildWsUrl();
  const secureUrl = globalThis.location.protocol === 'https:' ? url.replace(/^ws:/, 'wss:') : url;

  // 添加多路复用协议头
  ws.value = new WebSocket(secureUrl, 'nexus-mux');
  isConnecting.value = true;

  ws.value.onopen = () => {
    isConnecting.value = false;
    reconnectManager.reset();
    log.info('[MultiplexTransport] 物理连接已建立');

    // 通知所有通道物理连接已就绪（包括 connecting 状态的首连通道）
    for (const channel of channels.values()) {
      if (channel.connectionStatus.value !== 'connected') {
        sendConnectToChannel(channel);
      }
    }
  };

  ws.value.onmessage = (event: MessageEvent) => {
    const message = parseWebSocketMessage(event.data);
    if (message) {
      dispatchToChannel(message);
    }
  };

  ws.value.onerror = () => {
    isConnecting.value = false;
    log.error('[MultiplexTransport] 物理连接错误');
  };

  ws.value.onclose = (event) => {
    isConnecting.value = false;
    ws.value = null;

    // 通知所有通道物理连接已断开
    for (const channel of channels.values()) {
      channel.connectionStatus.value = 'disconnected';
      channel.isSftpReady.value = false;
    }

    // 自动重连
    if (!reconnectManager.state.intentionalDisconnect && event.code !== 1000) {
      scheduleReconnect();
    }
  };
}

/**
 * 安排重连
 */
function scheduleReconnect(): void {
  if (!reconnectManager.shouldReconnect()) {
    log.warn('[MultiplexTransport] 重连次数已达上限');
    return;
  }

  const delay = reconnectManager.getBackoffDelay(reconnectManager.incrementAttempts());
  reconnectManager.scheduleTimer(() => connectPhysical(), delay);
}

/**
 * 创建逻辑通道
 * @param sid 会话 ID
 * @param dbConnectionId 数据库连接 ID
 * @param options 可选参数
 * @returns 通道控制接口
 */
export function createChannel(
  sid: string,
  dbConnectionId: string,
  options?: { isResumeFlow?: boolean },
): MultiplexChannel {
  if (channels.has(sid)) {
    log.warn(`[MultiplexTransport] 通道 ${sid} 已存在，将覆盖`);
  }

  const isResumeFlow = options?.isResumeFlow ?? false;
  const channelState: ChannelState = {
    sid,
    dbConnectionId,
    connectionStatus: ref<ConnectionStatus>('connecting'),
    statusMessage: ref('正在连接...'),
    isSftpReady: ref(false),
    messageHandlers: new Map(),
    isResumeFlow,
  };

  channels.set(sid, channelState);

  // 如果物理连接未建立，先建立连接（onopen 中会自动发送 ssh:connect）
  if (ws.value?.readyState !== WebSocket.OPEN) {
    connectPhysical();
  } else {
    // 物理连接已就绪，直接发送 ssh:connect
    sendConnectToChannel(channelState);
  }

  // 返回通道控制接口（直接暴露 Ref，保证响应式）
  // 注意：sid 使用 getter 读取 channelState.sid，确保重映射后使用新 key
  return {
    get sid() {
      return channelState.sid;
    },
    connectionStatus: readonly(channelState.connectionStatus),
    statusMessage: readonly(channelState.statusMessage),
    isSftpReady: readonly(channelState.isSftpReady),

    connect: () => {
      if (ws.value?.readyState !== WebSocket.OPEN) {
        connectPhysical();
      } else {
        sendConnectToChannel(channelState);
      }
    },

    disconnect: () => {
      channels.delete(channelState.sid);
      log.debug(`[MultiplexTransport] 通道 ${channelState.sid} 已断开`);
    },

    sendMessage: (message: WebSocketMessage) => {
      return sendToChannel(channelState.sid, message);
    },

    onMessage: (
      type: string,
      handler: (payload: MessagePayload, message: WebSocketMessage) => void,
    ) => {
      let existingHandlers = channelState.messageHandlers.get(type);
      if (!existingHandlers) {
        existingHandlers = new Set();
        channelState.messageHandlers.set(type, existingHandlers);
      }
      existingHandlers.add(handler);

      return () => {
        const currentHandlers = channelState.messageHandlers.get(type);
        if (currentHandlers) {
          currentHandlers.delete(handler);
          if (currentHandlers.size === 0) {
            channelState.messageHandlers.delete(type);
          }
        }
      };
    },
  };
}

/**
 * 获取当前活跃通道数
 */
export function getChannelCount(): number {
  return channels.size;
}

/**
 * 检查物理连接状态
 */
export function isConnected(): boolean {
  return ws.value?.readyState === WebSocket.OPEN;
}

/**
 * 手动关闭物理连接
 */
export function disconnectAll(): void {
  reconnectManager.state.intentionalDisconnect = true;
  reconnectManager.clearTimer();

  if (ws.value) {
    ws.value.close(1000, '客户端主动断开');
    ws.value = null;
  }

  for (const channel of channels.values()) {
    channel.connectionStatus.value = 'disconnected';
  }
  channels.clear();
}
