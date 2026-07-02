/**
 * WebSocket 消息解析与验证
 * 从 useWebSocketConnection.ts 提取，负责消息类型白名单和 Payload 校验
 */

import type { MessagePayload, WebSocketMessage } from '../../types/websocket.types';

/**
 * 允许的消息类型白名单
 */
export const ALLOWED_MESSAGE_TYPES = new Set([
  // SSH/Terminal
  'ssh:connect',
  'ssh:connected',
  'ssh:disconnected',
  'ssh:error',
  'ssh:output',
  'ssh:status',
  'ssh:exec_silent:result',
  'ssh:exec_silent:error',
  'rdp:error',
  'terminal:data',
  'terminal:resize',
  // SFTP
  'sftp_ready',
  'sftp:ready',
  'sftp:list',
  'sftp:upload:progress',
  'sftp:download:progress',
  'sftp:error',
  'sftp:realpath:success',
  'sftp:realpath:error',
  'sftp:readdir:success',
  'sftp:readdir:error',
  'sftp:stat:success',
  'sftp:stat:error',
  'sftp:mkdir:success',
  'sftp:mkdir:error',
  'sftp:rmdir:success',
  'sftp:rmdir:error',
  'sftp:unlink:success',
  'sftp:unlink:error',
  'sftp:rename:success',
  'sftp:rename:error',
  'sftp:chmod:success',
  'sftp:chmod:error',
  'sftp:readfile:success',
  'sftp:readfile:error',
  'sftp:writefile:success',
  'sftp:writefile:error',
  'sftp:copy:success',
  'sftp:copy:error',
  'sftp:move:success',
  'sftp:move:error',
  'sftp:compress:success',
  'sftp:compress:error',
  'sftp:compress:progress',
  'sftp:decompress:success',
  'sftp:decompress:error',
  'sftp:decompress:progress',
  'sftp:command_not_found',
  'sftp:upload:ready',
  'sftp:upload:success',
  'sftp:upload:cancelled',
  'sftp:upload:pause',
  'sftp:upload:resume',
  'sftp:upload:start:ack',
  'sftp:upload:chunk:ack',
  'sftp:upload:complete',
  'sftp:upload:error',
  'sftp_error',
  // Docker
  'docker:status:update',
  'docker:status:error',
  'docker:command:success',
  'docker:command:error',
  'docker:stats:update',
  'docker:stats:error',
  'request_docker_status_update',
  // Status monitor
  'status_update',
  'status:error',
  // Batch
  'batch:started',
  'batch:cancelled',
  'batch:subtask:update',
  'batch:overall',
  'batch:log',
  // AI
  'ai:message',
  'ai:error',
  // SSH Suspend
  'SSH_MARKED_FOR_SUSPEND_ACK',
  'SSH_UNMARKED_FOR_SUSPEND_ACK',
  'SSH_SUSPEND_STARTED',
  'SSH_SUSPEND_LIST_RESPONSE',
  'SSH_SUSPEND_RESUMED',
  'SSH_OUTPUT_CACHED_CHUNK',
  'SSH_SUSPEND_TERMINATED',
  'SSH_SUSPEND_ENTRY_REMOVED',
  'SSH_SUSPEND_NAME_EDITED',
  'SSH_SUSPEND_AUTO_TERMINATED',
  // Generic
  'error',
  // Internal
  'internal:opened',
  'internal:closed',
  'internal:error',
  'internal:raw',
]);

/**
 * Payload 校验器映射
 */
interface PayloadValidatorSchema {
  [key: string]: (payload: MessagePayload) => boolean;
}

export const payloadValidators: PayloadValidatorSchema = {
  'terminal:data': (p) => typeof p === 'string',
  'terminal:resize': (p) => {
    const obj = p as Record<string, unknown> | undefined;
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.cols === 'number' &&
      typeof obj.rows === 'number'
    );
  },
  'sftp:upload:progress': (p) => {
    const obj = p as Record<string, unknown> | undefined;
    return typeof obj === 'object' && obj !== null && typeof obj.uploadId === 'string';
  },
  status_update: (p) => {
    const obj = p as Record<string, unknown> | undefined;
    return (
      typeof obj === 'object' &&
      obj !== null &&
      typeof obj.status === 'object' &&
      obj.status !== null
    );
  },
};

/**
 * 安全地解析 WebSocket 消息
 * @returns 解析后的消息对象，或 null（解析失败时）
 */
export function parseWebSocketMessage(
  rawData: string | ArrayBuffer | Blob,
): WebSocketMessage | null {
  try {
    const message: WebSocketMessage = JSON.parse(rawData.toString());
    const normalizedType = typeof message.type === 'string' ? message.type.trim() : '';

    if (!normalizedType) {
      return null;
    }

    if (!ALLOWED_MESSAGE_TYPES.has(normalizedType)) {
      return null;
    }

    message.type = normalizedType;

    // 校验 Payload 结构
    const validator = payloadValidators[normalizedType];
    if (validator && !validator(message.payload)) {
      return null;
    }

    return message;
  } catch {
    return null;
  }
}
