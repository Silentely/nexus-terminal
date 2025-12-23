// WebSocket 连接状态类型
// --- SSH Suspend Mode WebSocket Message Types ---

// 导入挂起会话类型，用于相关消息的 payload
import type { SuspendedSshSession } from './ssh-suspend.types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// 通用消息负载类型定义
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MessagePayload = any;

// WebSocket 消息结构接口
export interface WebSocketMessage {
  type: string; // 消息类型
  payload?: MessagePayload; // 消息负载
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any; // 允许其他属性，如 requestId, encoding 等
}

// 消息处理器函数类型
export type MessageHandler = (payload: MessagePayload, message: WebSocketMessage) => void; // 恢复 message 参数为必需
export interface SftpUploadProgressPayload {
  uploadId: string; // 虽然 uploadId 在 WebSocketMessage 顶层，payload 里也包含以明确关联
  bytesWritten: number;
  totalSize: number;
  progress: number; // 0-100
}
export interface SftpUploadProgressMessage extends WebSocketMessage {
  type: 'sftp:upload:progress';
  uploadId: string; // uploadId 也在顶层消息中，这里为了明确 payload 关联
  payload: SftpUploadProgressPayload;
} // 路径: packages/frontend/src/types/ssh-suspend.types.ts

// --- Client to Server (C2S) Message Payloads ---
export interface SshSuspendStartReqPayload {
  sessionId: string;
  initialBuffer?: string; // Optional: content of the terminal buffer at the time of suspend
}

export interface SshSuspendResumeReqPayload {
  suspendSessionId: string;
  newFrontendSessionId: string;
}

export interface SshSuspendTerminateReqPayload {
  suspendSessionId: string;
}

export interface SshSuspendRemoveEntryReqPayload {
  suspendSessionId: string;
}

export interface SshSuspendEditNameReqPayload {
  suspendSessionId: string;
  customName: string;
}

export interface SshMarkForSuspendReqPayload {
  sessionId: string;
  initialBuffer?: string; // +++ 可选的初始屏幕缓冲区内容 +++
}

export interface SshUnmarkForSuspendReqPayload {
  sessionId: string;
}

// --- Server to Client (S2C) Message Payloads ---
export interface SshMarkedForSuspendAckPayload {
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface SshUnmarkedForSuspendAckPayload {
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendStartedRespPayload {
  frontendSessionId: string;
  suspendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendListResponsePayload {
  suspendSessions: SuspendedSshSession[];
}

export interface SshSuspendResumedNotifPayload {
  suspendSessionId: string;
  newFrontendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshOutputCachedChunkPayload {
  frontendSessionId: string;
  data: string;
  isLastChunk: boolean;
}

export interface SshSuspendTerminatedRespPayload {
  suspendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendEntryRemovedRespPayload {
  suspendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendNameEditedRespPayload {
  suspendSessionId: string;
  success: boolean;
  customName?: string;
  error?: string;
}

export interface SshSuspendAutoTerminatedNotifPayload {
  suspendSessionId: string;
  reason: string;
}

// --- Specific C2S Message Interfaces ---
export interface SshSuspendStartReqMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_START';
  payload: SshSuspendStartReqPayload;
}

export interface SshSuspendListReqMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_LIST_REQUEST';
  payload?: {}; // 明确 payload 可以为空对象
}

export interface SshSuspendResumeReqMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_RESUME_REQUEST';
  payload: SshSuspendResumeReqPayload;
}

export interface SshSuspendTerminateReqMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_TERMINATE_REQUEST';
  payload: SshSuspendTerminateReqPayload;
}

export interface SshSuspendRemoveEntryReqMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_REMOVE_ENTRY';
  payload: SshSuspendRemoveEntryReqPayload;
}

export interface SshSuspendEditNameReqMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_EDIT_NAME';
  payload: SshSuspendEditNameReqPayload;
}

export interface SshMarkForSuspendReqMessage extends WebSocketMessage {
  type: 'SSH_MARK_FOR_SUSPEND';
  payload: SshMarkForSuspendReqPayload;
}

export interface SshUnmarkForSuspendReqMessage extends WebSocketMessage {
  type: 'SSH_UNMARK_FOR_SUSPEND';
  payload: SshUnmarkForSuspendReqPayload;
}

// --- Specific S2C Message Interfaces ---
export interface SshMarkedForSuspendAckMessage extends WebSocketMessage {
  type: 'SSH_MARKED_FOR_SUSPEND_ACK';
  payload: SshMarkedForSuspendAckPayload;
}

export interface SshUnmarkedForSuspendAckMessage extends WebSocketMessage {
  type: 'SSH_UNMARKED_FOR_SUSPEND_ACK';
  payload: SshUnmarkedForSuspendAckPayload;
}

export interface SshSuspendStartedRespMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_STARTED';
  payload: SshSuspendStartedRespPayload;
}

export interface SshSuspendListResponseMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_LIST_RESPONSE';
  payload: SshSuspendListResponsePayload;
}

export interface SshSuspendResumedNotifMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_RESUMED';
  payload: SshSuspendResumedNotifPayload;
}

export interface SshOutputCachedChunkMessage extends WebSocketMessage {
  type: 'SSH_OUTPUT_CACHED_CHUNK';
  payload: SshOutputCachedChunkPayload;
}

export interface SshSuspendTerminatedRespMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_TERMINATED';
  payload: SshSuspendTerminatedRespPayload;
}

export interface SshSuspendEntryRemovedRespMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_ENTRY_REMOVED';
  payload: SshSuspendEntryRemovedRespPayload;
}

export interface SshSuspendNameEditedRespMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_NAME_EDITED';
  payload: SshSuspendNameEditedRespPayload;
}

export interface SshSuspendAutoTerminatedNotifMessage extends WebSocketMessage {
  type: 'SSH_SUSPEND_AUTO_TERMINATED';
  payload: SshSuspendAutoTerminatedNotifPayload;
}

// Union type for all SSH Suspend related messages (optional, but can be useful)
export type SshSuspendC2SMessage =
  | SshSuspendStartReqMessage
  | SshSuspendListReqMessage
  | SshSuspendResumeReqMessage
  | SshSuspendTerminateReqMessage
  | SshSuspendRemoveEntryReqMessage
  | SshSuspendEditNameReqMessage
  | SshMarkForSuspendReqMessage
  | SshUnmarkForSuspendReqMessage;

export type SshSuspendS2CMessage =
  | SshMarkedForSuspendAckMessage
  | SshUnmarkedForSuspendAckMessage
  | SshSuspendStartedRespMessage
  | SshSuspendListResponseMessage
  | SshSuspendResumedNotifMessage
  | SshOutputCachedChunkMessage
  | SshSuspendTerminatedRespMessage
  | SshSuspendEntryRemovedRespMessage
  | SshSuspendNameEditedRespMessage
  | SshSuspendAutoTerminatedNotifMessage;

export type AllSshSuspendMessages = SshSuspendC2SMessage | SshSuspendS2CMessage;
