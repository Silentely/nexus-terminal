// WebSocket 连接状态类型
// --- SSH Suspend Mode WebSocket Message Types ---

// 导入挂起会话类型，用于相关消息的 payload
import type { SuspendedSshSession } from './ssh-suspend.types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

// ========================================
// 消息负载类型定义
// ========================================

// 基础 payload 类型：字符串或结构化对象
// 使用 object 而非 Record<string, unknown>，因为 TS 接口没有隐式索引签名
export type MessagePayload = string | object | undefined;

// --- SSH 消息 Payload ---
export interface SshConnectPayload {
  connectionId: number;
}

export interface SshConnectedPayload {
  connectionId: number | string;
  sessionId: string;
}

export interface SshResizePayload {
  cols: number;
  rows: number;
}

export interface SshExecSilentResultPayload {
  output: string;
}

export interface SshExecSilentErrorPayload {
  error: string;
}

// --- SFTP 消息 Payload ---
export interface SftpReaddirSuccessPayload {
  files: Array<{
    filename: string;
    longname: string;
    attrs: {
      size: number;
      uid: number;
      gid: number;
      mode: number;
      atime: number;
      mtime: number;
      isDirectory: boolean;
      isFile: boolean;
      isSymbolicLink: boolean;
    };
  }>;
}

export interface SftpRealpathSuccessPayload {
  requestedPath?: string;
  absolutePath?: string;
  targetType?: 'file' | 'directory' | 'unknown';
  error?: string;
}

export interface SftpStatSuccessPayload {
  // 文件属性信息
  [key: string]: unknown;
}

export interface SftpMkdirSuccessPayload {
  filename?: string;
  longname?: string;
  attrs?: Record<string, unknown>;
}

export interface SftpRenameSuccessPayload {
  oldPath: string;
  newPath: string;
  newItem?: SftpMkdirSuccessPayload | null;
}

export interface SftpCopySuccessPayload {
  destination: string;
  items?: Array<{
    filename: string;
    longname: string;
    attrs: Record<string, unknown>;
  }> | null;
}

export interface SftpMoveSuccessPayload {
  sources: string[];
  destination: string;
  items?: Array<{
    filename: string;
    longname: string;
    attrs: Record<string, unknown>;
  }> | null;
}

export interface SftpCompressSuccessPayload {
  message: string;
}

export interface SftpDecompressSuccessPayload {
  message: string;
}

export interface SftpUploadProgressPayload {
  uploadId: string;
  bytesWritten: number;
  totalSize: number;
  progress: number; // 0-100
}

export interface SftpArchiveProgressPayload {
  requestId: string;
  fileCount: number;
  currentFile?: string;
}

export interface SftpUploadReadyPayload {
  uploadId?: string;
}

export interface SftpUploadChunkAckPayload {
  uploadId?: string;
  windowSlots?: number;
}

export interface SftpCommandNotFoundPayload {
  operation: 'compress' | 'decompress';
  command: string;
  message?: string;
}

export interface SftpErrorPayload {
  error: string;
  details?: string;
}

// --- Docker 消息 Payload ---
// WebSocket 消息允许服务端携带额外字段，索引签名确保前向兼容
export interface DockerStatusUpdatePayload {
  containers: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

export interface DockerStatsUpdatePayload {
  stats: Record<string, unknown>;
  [key: string]: unknown;
}

// --- Batch 消息 Payload ---
export interface BatchSubtaskUpdatePayload {
  subtaskId: string;
  status: string;
  [key: string]: unknown;
}

export interface BatchOverallPayload {
  taskId: string;
  status: string;
  [key: string]: unknown;
}

export interface BatchStartedPayload {
  taskId: string;
  total?: number;
  concurrency?: number;
  [key: string]: unknown;
}

export interface BatchTerminalPayload {
  taskId: string;
  status?: string;
  overallProgress?: number;
  completed?: number;
  failed?: number;
  cancelled?: number;
  reason?: string;
  [key: string]: unknown;
}

// --- AI 消息 Payload ---
export interface AiMessagePayload {
  content: string;
  [key: string]: unknown;
}

// --- SSH Suspend 消息 Payload ---
export interface SshMarkedForSuspendAckPayload {
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendResumedPayload {
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

// --- Terminal 消息 Payload ---
export interface TerminalResizePayload {
  cols: number;
  rows: number;
}

// ========================================
// WebSocket 消息结构接口
// ========================================

// 基础消息接口
export interface WebSocketMessage {
  type: string; // 消息类型
  payload?: MessagePayload; // 消息负载
  requestId?: string; // 请求关联 ID
  sessionId?: string; // 会话 ID
  sid?: string; // 多路复用会话 ID（可选）
  encoding?: string; // 数据编码方式（如 base64）
  path?: string; // 文件路径（SFTP 操作）
  uploadId?: string; // 上传任务 ID
  [key: string]: unknown; // 允许其他未知属性
}

// 强类型消息接口（用于类型安全的发送）
export interface TypedWebSocketMessage<T extends MessagePayload = MessagePayload> extends Omit<
  WebSocketMessage,
  'payload'
> {
  payload?: T;
}

// SSH 消息类型
export interface SshConnectMessage extends TypedWebSocketMessage<SshConnectPayload> {
  type: 'ssh:connect';
}

export interface SshConnectedMessage extends TypedWebSocketMessage<SshConnectedPayload> {
  type: 'ssh:connected';
}

export interface SshOutputMessage extends TypedWebSocketMessage<string> {
  type: 'ssh:output';
  encoding?: string;
}

export interface SshResizeMessage extends TypedWebSocketMessage<SshResizePayload> {
  type: 'ssh:resize';
  sessionId: string;
}

// SFTP 消息类型
export interface SftpReaddirMessage extends TypedWebSocketMessage<{ path: string }> {
  type: 'sftp:readdir';
  requestId: string;
}

export interface SftpMkdirMessage extends TypedWebSocketMessage<{ path: string }> {
  type: 'sftp:mkdir';
  requestId: string;
}

export interface SftpRmdirMessage extends TypedWebSocketMessage<{ path: string }> {
  type: 'sftp:rmdir';
  requestId: string;
}

export interface SftpUnlinkMessage extends TypedWebSocketMessage<{ path: string }> {
  type: 'sftp:unlink';
  requestId: string;
}

export interface SftpRenameMessage extends TypedWebSocketMessage<{
  oldPath: string;
  newPath: string;
}> {
  type: 'sftp:rename';
  requestId: string;
}

export interface SftpChmodMessage extends TypedWebSocketMessage<{ path: string; mode: number }> {
  type: 'sftp:chmod';
  requestId: string;
}

export interface SftpReadFileMessage extends TypedWebSocketMessage<{
  path: string;
  encoding?: string;
}> {
  type: 'sftp:readfile';
  requestId: string;
}

export interface SftpWriteFileMessage extends TypedWebSocketMessage<{
  path: string;
  content: string;
  encoding?: string;
}> {
  type: 'sftp:writefile';
  requestId: string;
}

export interface SftpCopyMessage extends TypedWebSocketMessage<{
  sources: string[];
  destination: string;
}> {
  type: 'sftp:copy';
  requestId: string;
}

export interface SftpMoveMessage extends TypedWebSocketMessage<{
  sources: string[];
  destination: string;
}> {
  type: 'sftp:move';
  requestId: string;
}

export interface SftpCompressMessage extends TypedWebSocketMessage<{
  sources: string[];
  destination: string;
  format: string;
}> {
  type: 'sftp:compress';
  requestId: string;
}

export interface SftpDecompressMessage extends TypedWebSocketMessage<{
  source: string;
  destination: string;
}> {
  type: 'sftp:decompress';
  requestId: string;
}

export interface SftpRealpathMessage extends TypedWebSocketMessage<{ path: string }> {
  type: 'sftp:realpath';
  requestId: string;
}

// --- SSH Silent Exec 消息类型 ---
export interface SshExecSilentRequestPayload {
  command?: string;
  commandsByShell?: Record<string, string>;
  timeoutMs?: number;
  shellFlavorHint?: 'posix' | 'powershell' | 'cmd' | 'fish';
  successCriteria?: 'any' | 'non_empty' | 'absolute_path';
  suppressTerminalPrompt?: boolean;
}

export interface SshExecSilentRequestMessage extends TypedWebSocketMessage<SshExecSilentRequestPayload> {
  type: 'ssh:exec_silent';
}

export interface SshExecSilentResultMessage extends TypedWebSocketMessage<SshExecSilentResultPayload> {
  type: 'ssh:exec_silent:result';
}

export interface SshExecSilentErrorMessage extends TypedWebSocketMessage<SshExecSilentErrorPayload> {
  type: 'ssh:exec_silent:error';
}

// ========================================
// 消息处理器类型定义
// ========================================

// 基础消息处理器类型（兼容旧代码）
export type MessageHandler = (payload: MessagePayload, message: WebSocketMessage) => void;
export interface SftpUploadProgressMessage extends TypedWebSocketMessage<SftpUploadProgressPayload> {
  type: 'sftp:upload:progress';
  uploadId: string;
}

// --- SFTP Upload 消息类型 ---
export interface SftpUploadStartMessage extends TypedWebSocketMessage<{
  uploadId: string;
  remotePath: string;
  size: number;
  relativePath?: string;
}> {
  type: 'sftp:upload:start';
}

export interface SftpUploadChunkMessage extends TypedWebSocketMessage<{
  uploadId: string;
  chunkIndex: number;
  data: string;
  isLast: boolean;
}> {
  type: 'sftp:upload:chunk';
}

export interface SftpUploadCancelMessage extends TypedWebSocketMessage<{ uploadId: string }> {
  type: 'sftp:upload:cancel';
}

// --- SFTP 消息处理器类型 ---
// 路径: packages/frontend/src/types/ssh-suspend.types.ts

// --- SSH Suspend Client to Server (C2S) 消息 Payload ---
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
  initialBuffer?: string;
}

export interface SshUnmarkForSuspendReqPayload {
  sessionId: string;
}

// --- SSH Suspend Server to Client (S2C) 消息 Payload ---
export interface SshUnmarkedForSuspendAckPayload {
  sessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendStartedPayload {
  frontendSessionId: string;
  suspendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendListResponsePayload {
  suspendSessions: SuspendedSshSession[];
}

export interface SshSuspendTerminatedPayload {
  suspendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendEntryRemovedPayload {
  suspendSessionId: string;
  success: boolean;
  error?: string;
}

export interface SshSuspendNameEditedPayload {
  suspendSessionId: string;
  success: boolean;
  customName?: string;
  error?: string;
}

export interface SshSuspendAutoTerminatedPayload {
  suspendSessionId: string;
  reason: string;
}

// --- SSH Suspend C2S 消息接口 ---
export interface SshSuspendStartReqMessage extends TypedWebSocketMessage<SshSuspendStartReqPayload> {
  type: 'SSH_SUSPEND_START';
}

export interface SshSuspendListReqMessage extends TypedWebSocketMessage<Record<string, never>> {
  type: 'SSH_SUSPEND_LIST_REQUEST';
}

export interface SshSuspendResumeReqMessage extends TypedWebSocketMessage<SshSuspendResumeReqPayload> {
  type: 'SSH_SUSPEND_RESUME_REQUEST';
}

export interface SshSuspendTerminateReqMessage extends TypedWebSocketMessage<SshSuspendTerminateReqPayload> {
  type: 'SSH_SUSPEND_TERMINATE_REQUEST';
}

export interface SshSuspendRemoveEntryReqMessage extends TypedWebSocketMessage<SshSuspendRemoveEntryReqPayload> {
  type: 'SSH_SUSPEND_REMOVE_ENTRY';
}

export interface SshSuspendEditNameReqMessage extends TypedWebSocketMessage<SshSuspendEditNameReqPayload> {
  type: 'SSH_SUSPEND_EDIT_NAME';
}

export interface SshMarkForSuspendReqMessage extends TypedWebSocketMessage<SshMarkForSuspendReqPayload> {
  type: 'SSH_MARK_FOR_SUSPEND';
}

export interface SshUnmarkForSuspendReqMessage extends TypedWebSocketMessage<SshUnmarkForSuspendReqPayload> {
  type: 'SSH_UNMARK_FOR_SUSPEND';
}

// --- SSH Suspend S2C 消息接口 ---
export interface SshMarkedForSuspendAckMessage extends TypedWebSocketMessage<SshMarkedForSuspendAckPayload> {
  type: 'SSH_MARKED_FOR_SUSPEND_ACK';
}

export interface SshUnmarkedForSuspendAckMessage extends TypedWebSocketMessage<SshUnmarkedForSuspendAckPayload> {
  type: 'SSH_UNMARKED_FOR_SUSPEND_ACK';
}

export interface SshSuspendStartedMessage extends TypedWebSocketMessage<SshSuspendStartedPayload> {
  type: 'SSH_SUSPEND_STARTED';
}

export interface SshSuspendListResponseMessage extends TypedWebSocketMessage<SshSuspendListResponsePayload> {
  type: 'SSH_SUSPEND_LIST_RESPONSE';
}

export interface SshSuspendResumedMessage extends TypedWebSocketMessage<SshSuspendResumedPayload> {
  type: 'SSH_SUSPEND_RESUMED';
}

export interface SshOutputCachedChunkMessage extends TypedWebSocketMessage<SshOutputCachedChunkPayload> {
  type: 'SSH_OUTPUT_CACHED_CHUNK';
}

export interface SshSuspendTerminatedMessage extends TypedWebSocketMessage<SshSuspendTerminatedPayload> {
  type: 'SSH_SUSPEND_TERMINATED';
}

export interface SshSuspendEntryRemovedMessage extends TypedWebSocketMessage<SshSuspendEntryRemovedPayload> {
  type: 'SSH_SUSPEND_ENTRY_REMOVED';
}

export interface SshSuspendNameEditedMessage extends TypedWebSocketMessage<SshSuspendNameEditedPayload> {
  type: 'SSH_SUSPEND_NAME_EDITED';
}

export interface SshSuspendAutoTerminatedMessage extends TypedWebSocketMessage<SshSuspendAutoTerminatedPayload> {
  type: 'SSH_SUSPEND_AUTO_TERMINATED';
}

// --- Docker 消息接口 ---
export interface DockerStatusUpdateMessage extends TypedWebSocketMessage<DockerStatusUpdatePayload> {
  type: 'docker:status:update';
}

export interface DockerCommandSuccessMessage extends TypedWebSocketMessage<
  Record<string, unknown>
> {
  type: 'docker:command:success';
}

export interface DockerStatsUpdateMessage extends TypedWebSocketMessage<DockerStatsUpdatePayload> {
  type: 'docker:stats:update';
}

// --- Batch 消息接口 ---
export interface BatchSubtaskUpdateMessage extends TypedWebSocketMessage<BatchSubtaskUpdatePayload> {
  type: 'batch:subtask:update';
}

export interface BatchOverallMessage extends TypedWebSocketMessage<BatchOverallPayload> {
  type: 'batch:overall';
}

export interface BatchLogMessage extends TypedWebSocketMessage<{
  message: string;
  [key: string]: unknown;
}> {
  type: 'batch:log';
}

// --- AI 消息接口 ---
export interface AiChatMessage extends TypedWebSocketMessage<AiMessagePayload> {
  type: 'ai:message';
}

export interface AiErrorMessage extends TypedWebSocketMessage<{ error: string }> {
  type: 'ai:error';
}

// --- Terminal 消息接口 ---
export interface TerminalDataMessage extends TypedWebSocketMessage<string> {
  type: 'terminal:data';
}

export interface TerminalResizeMessage extends TypedWebSocketMessage<TerminalResizePayload> {
  type: 'terminal:resize';
}

// --- 补充缺失的消息接口 ---

// SSH 补充消息
export interface SshDisconnectedMessage extends TypedWebSocketMessage<string> {
  type: 'ssh:disconnected';
}

export interface SshErrorMessage extends TypedWebSocketMessage<string | { message: string }> {
  type: 'ssh:error';
}

export interface SshStatusMessage extends TypedWebSocketMessage<{
  key: string;
  params?: Record<string, unknown>;
}> {
  type: 'ssh:status';
}

/** SSH 路由规划信息（跳板链路可视化） */
export interface RouteHop {
  host: string;
  port: number;
  username: string;
  name?: string;
  latencyMs?: number;
}

export interface ConnectionRoutePlan {
  hops: RouteHop[];
  totalLatencyMs: number;
  directConnection: boolean;
}

export interface SshRoutePlanMessage extends TypedWebSocketMessage<ConnectionRoutePlan> {
  type: 'ssh:route_plan';
}

// SFTP 补充消息
export interface SftpReadyMessage extends TypedWebSocketMessage<{ ready: boolean }> {
  type: 'sftp:ready';
}

export interface SftpErrorMessage extends TypedWebSocketMessage<string | { error: string }> {
  type: 'sftp:error';
}

/** @deprecated 向后兼容旧版 sftp_error 类型，新代码应使用 SftpErrorMessage (type: 'sftp:error') */
export interface SftpErrorMessageLegacy extends TypedWebSocketMessage<string | { error: string }> {
  type: 'sftp_error';
}

// SFTP 通用成功/错误 payload
export interface SftpActionSuccessPayload {
  path?: string;
  requestId?: string;
}

export interface SftpActionErrorPayload {
  error: string;
  details?: string;
}

// SFTP readdir 消息
export interface SftpReaddirSuccessMessage extends TypedWebSocketMessage<SftpReaddirSuccessPayload> {
  type: 'sftp:readdir:success';
}

export interface SftpReaddirErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:readdir:error';
}

// SFTP mkdir 消息
export interface SftpMkdirSuccessMessage extends TypedWebSocketMessage<SftpMkdirSuccessPayload> {
  type: 'sftp:mkdir:success';
}

export interface SftpMkdirErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:mkdir:error';
}

// SFTP rmdir 消息
export interface SftpRmdirSuccessMessage extends TypedWebSocketMessage<SftpActionSuccessPayload> {
  type: 'sftp:rmdir:success';
}

export interface SftpRmdirErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:rmdir:error';
}

// SFTP unlink 消息
export interface SftpUnlinkSuccessMessage extends TypedWebSocketMessage<SftpActionSuccessPayload> {
  type: 'sftp:unlink:success';
}

export interface SftpUnlinkErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:unlink:error';
}

// SFTP rename 消息
export interface SftpRenameSuccessMessage extends TypedWebSocketMessage<SftpRenameSuccessPayload> {
  type: 'sftp:rename:success';
}

export interface SftpRenameErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:rename:error';
}

// SFTP chmod 消息
export interface SftpChmodSuccessMessage extends TypedWebSocketMessage<SftpActionSuccessPayload> {
  type: 'sftp:chmod:success';
}

export interface SftpChmodErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:chmod:error';
}

// SFTP readfile 消息
export interface SftpReadFileSuccessMessage extends TypedWebSocketMessage<{
  content: string;
  encoding?: string;
}> {
  type: 'sftp:readfile:success';
}

export interface SftpReadFileErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:readfile:error';
}

// SFTP writefile 消息
export interface SftpWriteFileSuccessMessage extends TypedWebSocketMessage<SftpActionSuccessPayload> {
  type: 'sftp:writefile:success';
}

export interface SftpWriteFileErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:writefile:error';
}

// SFTP copy 消息
export interface SftpCopySuccessMessage extends TypedWebSocketMessage<SftpCopySuccessPayload> {
  type: 'sftp:copy:success';
}

export interface SftpCopyErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:copy:error';
}

// SFTP move 消息
export interface SftpMoveSuccessMessage extends TypedWebSocketMessage<SftpMoveSuccessPayload> {
  type: 'sftp:move:success';
}

export interface SftpMoveErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:move:error';
}

// SFTP compress 消息
export interface SftpCompressSuccessMessage extends TypedWebSocketMessage<SftpCompressSuccessPayload> {
  type: 'sftp:compress:success';
}

export interface SftpCompressErrorMessage extends TypedWebSocketMessage<string | SftpErrorPayload> {
  type: 'sftp:compress:error';
}

// SFTP decompress 消息
export interface SftpDecompressSuccessMessage extends TypedWebSocketMessage<SftpDecompressSuccessPayload> {
  type: 'sftp:decompress:success';
}

export interface SftpDecompressErrorMessage extends TypedWebSocketMessage<
  string | SftpErrorPayload
> {
  type: 'sftp:decompress:error';
}

// SFTP archive progress 消息（压缩/解压进度）
export interface SftpCompressProgressMessage extends TypedWebSocketMessage<SftpArchiveProgressPayload> {
  type: 'sftp:compress:progress';
}

export interface SftpDecompressProgressMessage extends TypedWebSocketMessage<SftpArchiveProgressPayload> {
  type: 'sftp:decompress:progress';
}

// SFTP realpath 消息
export interface SftpRealpathSuccessMessage extends TypedWebSocketMessage<SftpRealpathSuccessPayload> {
  type: 'sftp:realpath:success';
}

export interface SftpRealpathErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:realpath:error';
}

// SFTP stat 消息
export interface SftpStatSuccessMessage extends TypedWebSocketMessage<SftpStatSuccessPayload> {
  type: 'sftp:stat:success';
}

export interface SftpStatErrorMessage extends TypedWebSocketMessage<string> {
  type: 'sftp:stat:error';
}

// SFTP upload 消息
export interface SftpUploadReadyMessage extends TypedWebSocketMessage<SftpUploadReadyPayload> {
  type: 'sftp:upload:ready';
}

export interface SftpUploadSuccessMessage extends TypedWebSocketMessage<SftpMkdirSuccessPayload> {
  type: 'sftp:upload:success';
}

export interface SftpUploadCancelledMessage extends TypedWebSocketMessage<{ uploadId: string }> {
  type: 'sftp:upload:cancelled';
}

export interface SftpUploadErrorMessage extends TypedWebSocketMessage<
  string | { message: string }
> {
  type: 'sftp:upload:error';
}

export interface SftpUploadChunkAckMessage extends TypedWebSocketMessage<SftpUploadChunkAckPayload> {
  type: 'sftp:upload:chunk:ack';
}

// SFTP download 消息
export interface SftpDownloadProgressMessage extends TypedWebSocketMessage<{
  bytesWritten: number;
  totalSize: number;
  progress: number;
}> {
  type: 'sftp:download:progress';
}

// SFTP command_not_found 消息
export interface SftpCommandNotFoundMessage extends TypedWebSocketMessage<SftpCommandNotFoundPayload> {
  type: 'sftp:command_not_found';
}

// Docker 补充消息
export interface DockerStatusErrorMessage extends TypedWebSocketMessage<string> {
  type: 'docker:status:error';
}

export interface DockerCommandErrorMessage extends TypedWebSocketMessage<string> {
  type: 'docker:command:error';
}

export interface DockerStatsErrorMessage extends TypedWebSocketMessage<string> {
  type: 'docker:stats:error';
}

// Batch 补充消息
export interface BatchStartedMessage extends TypedWebSocketMessage<BatchStartedPayload> {
  type: 'batch:started';
}

export interface BatchCompletedMessage extends TypedWebSocketMessage<BatchTerminalPayload> {
  type: 'batch:completed';
}

export interface BatchFailedMessage extends TypedWebSocketMessage<BatchTerminalPayload> {
  type: 'batch:failed';
}

export interface BatchCancelledMessage extends TypedWebSocketMessage<BatchTerminalPayload> {
  type: 'batch:cancelled';
}

// 通用消息
export interface StatusUpdateMessage extends TypedWebSocketMessage<{
  status: Record<string, unknown>;
}> {
  type: 'status_update';
}

export interface StatusErrorMessage extends TypedWebSocketMessage<string> {
  type: 'status:error';
}

export interface GenericErrorMessage extends TypedWebSocketMessage<string | { message: string }> {
  type: 'error';
}

// ========================================
// 联合类型定义
// ========================================

// SSH Suspend C2S 消息联合类型
export type SshSuspendC2SMessage =
  | SshSuspendStartReqMessage
  | SshSuspendListReqMessage
  | SshSuspendResumeReqMessage
  | SshSuspendTerminateReqMessage
  | SshSuspendRemoveEntryReqMessage
  | SshSuspendEditNameReqMessage
  | SshMarkForSuspendReqMessage
  | SshUnmarkForSuspendReqMessage;

// SSH Suspend S2C 消息联合类型
export type SshSuspendS2CMessage =
  | SshMarkedForSuspendAckMessage
  | SshUnmarkedForSuspendAckMessage
  | SshSuspendStartedMessage
  | SshSuspendListResponseMessage
  | SshSuspendResumedMessage
  | SshOutputCachedChunkMessage
  | SshSuspendTerminatedMessage
  | SshSuspendEntryRemovedMessage
  | SshSuspendNameEditedMessage
  | SshSuspendAutoTerminatedMessage;

// 所有 SSH Suspend 消息
export type AllSshSuspendMessages = SshSuspendC2SMessage | SshSuspendS2CMessage;

// SSH 消息联合类型
export type SshMessage =
  | SshConnectMessage
  | SshConnectedMessage
  | SshOutputMessage
  | SshResizeMessage
  | SshExecSilentResultMessage
  | SshExecSilentErrorMessage;

// SFTP 消息联合类型
export type SftpMessage =
  // C2S 请求消息
  | SftpReaddirMessage
  | SftpMkdirMessage
  | SftpRmdirMessage
  | SftpUnlinkMessage
  | SftpRenameMessage
  | SftpChmodMessage
  | SftpReadFileMessage
  | SftpWriteFileMessage
  | SftpCopyMessage
  | SftpMoveMessage
  | SftpCompressMessage
  | SftpDecompressMessage
  | SftpRealpathMessage
  | SftpUploadStartMessage
  | SftpUploadChunkMessage
  | SftpUploadCancelMessage
  // S2C 响应消息
  | SftpReadyMessage
  | SftpErrorMessage
  | SftpErrorMessageLegacy
  | SftpReaddirSuccessMessage
  | SftpReaddirErrorMessage
  | SftpMkdirSuccessMessage
  | SftpMkdirErrorMessage
  | SftpRmdirSuccessMessage
  | SftpRmdirErrorMessage
  | SftpUnlinkSuccessMessage
  | SftpUnlinkErrorMessage
  | SftpRenameSuccessMessage
  | SftpRenameErrorMessage
  | SftpChmodSuccessMessage
  | SftpChmodErrorMessage
  | SftpReadFileSuccessMessage
  | SftpReadFileErrorMessage
  | SftpWriteFileSuccessMessage
  | SftpWriteFileErrorMessage
  | SftpCopySuccessMessage
  | SftpCopyErrorMessage
  | SftpMoveSuccessMessage
  | SftpMoveErrorMessage
  | SftpCompressSuccessMessage
  | SftpCompressErrorMessage
  | SftpDecompressSuccessMessage
  | SftpDecompressErrorMessage
  | SftpCompressProgressMessage
  | SftpDecompressProgressMessage
  | SftpRealpathSuccessMessage
  | SftpRealpathErrorMessage
  | SftpStatSuccessMessage
  | SftpStatErrorMessage
  | SftpUploadProgressMessage
  | SftpUploadReadyMessage
  | SftpUploadSuccessMessage
  | SftpUploadCancelledMessage
  | SftpUploadErrorMessage
  | SftpUploadChunkAckMessage
  | SftpDownloadProgressMessage
  | SftpCommandNotFoundMessage;

// Terminal 消息联合类型
export type TerminalMessage = TerminalDataMessage | TerminalResizeMessage;

// Docker 消息联合类型
export type DockerMessage =
  | DockerStatusUpdateMessage
  | DockerCommandSuccessMessage
  | DockerStatsUpdateMessage;

// Batch 消息联合类型
export type BatchMessage =
  | BatchStartedMessage
  | BatchSubtaskUpdateMessage
  | BatchOverallMessage
  | BatchCompletedMessage
  | BatchFailedMessage
  | BatchCancelledMessage
  | BatchLogMessage;

// AI 消息联合类型
export type AiMessage = AiChatMessage | AiErrorMessage;

// 所有 WebSocket 消息的联合类型
export type AllWebSocketMessage =
  | SshMessage
  | SftpMessage
  | TerminalMessage
  | DockerMessage
  | BatchMessage
  | AiMessage
  | AllSshSuspendMessages
  | StatusUpdateMessage
  | StatusErrorMessage
  | GenericErrorMessage;
