import crypto from 'crypto';
import { Request } from 'express';

import WebSocket from 'ws';
import { AuthenticatedWebSocket, ClientState } from '../types';
import {
  clientStates,
  sftpService,
  statusMonitorService,
  auditLogService,
  notificationService,
  registerChannel,
} from '../state';
import * as SshService from '../../services/ssh.service';
import { cleanupClientConnection, registerSessionCleanup, sendWsMessage, safeSend } from '../utils';
import { isMultiplexEnabled } from '../multiplex';
import { temporaryLogStorageService } from '../../ssh-suspend/temporary-log-storage.service';
import { startDockerStatusPolling } from './docker.handler';
import { getErrorMessage } from '../../utils/AppError';
import { lookupGeoInfo } from '../../auth/ip-geo.service';
import { logger } from '../../utils/logger';
import { withLogContext } from '../../middleware/log-context.middleware';
import { sshConnectDuration } from '../../metrics/metrics.service';
import eventService, { AppEventType } from '../../services/event.service';
import { getOrCreateBatcher, destroyBatcher } from '../output-batcher';
import {
  consumeSuppressedPromptChunk,
  isLikelyShellPromptLine,
  isSilentExecOutputAccepted,
  isValidSshResizeDims,
  normalizeSilentExecSuccessCriteria,
  resolveSshInputData,
  type SilentExecSuccessCriteria,
} from './ssh-handler.utils';

type SilentExecShellFlavor = 'posix' | 'powershell' | 'cmd' | 'fish';

interface SilentExecPayload {
  command?: string;
  commandsByShell?: Record<string, unknown>;
  timeoutMs?: number;
  shellFlavorHint?: string;
  successCriteria?: string;
  suppressTerminalPrompt?: boolean;
}

interface SshConnectPayload {
  connectionId?: string | number;
  cols?: number;
  rows?: number;
  term?: string;
}

type SshInputPayload = string | { data?: string };

interface SshResizePayload {
  cols?: number;
  rows?: number;
}

const MAX_SILENT_OUTPUT_SIZE = 64 * 1024;
const MAX_SILENT_LINE_BUFFER_SIZE = 16 * 1024;
// Shell 就绪超时（毫秒），超时后认为 shell 挂起并报错
const SHELL_READY_TIMEOUT_MS = 10_000;
const TERMINAL_LINE_KILL_CONTROL = '\u0015';

interface PendingSilentExecRequest {
  ws: AuthenticatedWebSocket;
  sessionId: string;
  requestId: string;
  commandCandidates: string[];
  timeoutMs: number;
  successCriteria: SilentExecSuccessCriteria;
  attemptIndex: number;
  lastError?: string;
  startMarker: string;
  endMarker: string;
  pendingLineBuffer: string;
  isCollectingOutput: boolean;
  collectedOutput: string;
  suppressTerminalPrompt: boolean;
  timeoutId?: NodeJS.Timeout;
}

const pendingSilentExecRequests = new Map<string, PendingSilentExecRequest>();
// H-17: sessionId -> requestId 反向索引，避免并发请求被覆盖
const sessionToSilentExecRequestId = new Map<string, string>();
const pendingPromptSuppressionSessions = new Set<string>();

const clearSilentExecTimer = (request: PendingSilentExecRequest): void => {
  if (request.timeoutId) {
    clearTimeout(request.timeoutId);
    request.timeoutId = undefined;
  }
};

const finalizeSilentExecWithError = (sessionId: string, error: string): void => {
  const requestId = sessionToSilentExecRequestId.get(sessionId);
  const request = requestId ? pendingSilentExecRequests.get(requestId) : undefined;
  if (!request) {
    sessionToSilentExecRequestId.delete(sessionId);
    return;
  }
  clearSilentExecTimer(request);
  pendingSilentExecRequests.delete(request.requestId);
  sessionToSilentExecRequestId.delete(sessionId);
  pendingPromptSuppressionSessions.delete(sessionId);
  sendSilentExecResponse(
    request.ws,
    'ssh:exec_silent:error',
    request.requestId,
    { error },
    sessionId,
  );
};

const finalizeSilentExecWithResult = (sessionId: string, output: string): void => {
  const requestId = sessionToSilentExecRequestId.get(sessionId);
  const request = requestId ? pendingSilentExecRequests.get(requestId) : undefined;
  if (!request) {
    sessionToSilentExecRequestId.delete(sessionId);
    return;
  }
  clearSilentExecTimer(request);
  pendingSilentExecRequests.delete(request.requestId);
  sessionToSilentExecRequestId.delete(sessionId);
  if (request.suppressTerminalPrompt) {
    pendingPromptSuppressionSessions.add(sessionId);
  } else {
    pendingPromptSuppressionSessions.delete(sessionId);
  }
  sendSilentExecResponse(
    request.ws,
    'ssh:exec_silent:result',
    request.requestId,
    {
      output: output.replace(/\r/g, ''),
    },
    sessionId,
  );
};

const moveToNextSilentExecAttempt = (sessionId: string, reason: string): void => {
  const requestId = sessionToSilentExecRequestId.get(sessionId);
  const request = requestId ? pendingSilentExecRequests.get(requestId) : undefined;
  if (!request) {
    return;
  }
  clearSilentExecTimer(request);
  request.attemptIndex += 1;
  request.lastError = reason;
  request.isCollectingOutput = false;
  request.collectedOutput = '';
};

const appendSilentCollectedOutput = (request: PendingSilentExecRequest, chunk: string): void => {
  if (!chunk || request.collectedOutput.length >= MAX_SILENT_OUTPUT_SIZE) {
    return;
  }
  request.collectedOutput += chunk;
  if (request.collectedOutput.length > MAX_SILENT_OUTPUT_SIZE) {
    request.collectedOutput = request.collectedOutput.slice(0, MAX_SILENT_OUTPUT_SIZE);
  }
};

const createSilentExecMarker = (requestId: string, attemptIndex: number): string => {
  const normalizedRequestId = requestId.replace(/[^a-zA-Z0-9_-]/g, '_');
  const randomSuffix = crypto.randomUUID().replace(/-/g, '').slice(0, 10);
  return `${normalizedRequestId}_${attemptIndex}_${randomSuffix}`;
};

const startSilentExecAttempt = (sessionId: string): void => {
  const requestId = sessionToSilentExecRequestId.get(sessionId);
  const request = requestId ? pendingSilentExecRequests.get(requestId) : undefined;
  if (!request) {
    return;
  }

  const command = request.commandCandidates[request.attemptIndex];
  if (!command) {
    finalizeSilentExecWithError(
      sessionId,
      request.lastError || 'Failed to execute silent command in current shell.',
    );
    return;
  }

  const state = clientStates.get(sessionId);
  if (!state?.sshShellStream || !state.isShellReady) {
    finalizeSilentExecWithError(sessionId, 'Shell channel is not ready.');
    return;
  }

  const marker = createSilentExecMarker(request.requestId, request.attemptIndex);
  request.startMarker = `__NX_SILENT_START_${marker}__`;
  request.endMarker = `__NX_SILENT_END_${marker}__`;
  request.isCollectingOutput = false;
  request.collectedOutput = '';

  request.timeoutId = setTimeout(() => {
    // H-18: 超时后先发送 Ctrl+C 中止当前命令，避免旧命令输出污染新命令
    try {
      const currentState = clientStates.get(sessionId);
      if (currentState?.sshShellStream) {
        currentState.sshShellStream.write('\x03');
      }
    } catch (ctrlcError: unknown) {
      logger.debug(
        `[SSH Handler] 发送 Ctrl+C 失败 (会话: ${sessionId}):`,
        ctrlcError instanceof Error ? ctrlcError.message : ctrlcError,
      );
    }
    // 等待 500ms 让 Ctrl+C 生效后再启动下一尝试
    request.timeoutId = setTimeout(() => {
      moveToNextSilentExecAttempt(sessionId, 'Timed out while waiting for command output.');
      startSilentExecAttempt(sessionId);
    }, 500);
  }, request.timeoutMs);

  try {
    const wrappedCommand = `echo ${request.startMarker}\n${command}\necho ${request.endMarker}\n`;
    // 先清空当前编辑行，避免与用户未回车输入拼接（如 apt + echo => aptecho）。
    state.sshShellStream.write(`${TERMINAL_LINE_KILL_CONTROL}${wrappedCommand}`);
  } catch (error: unknown) {
    moveToNextSilentExecAttempt(
      sessionId,
      `Failed to write command to shell stream: ${getErrorMessage(error)}`,
    );
    startSilentExecAttempt(sessionId);
  }
};

const processSshStreamOutput = (sessionId: string, chunk: string): string => {
  const requestId = sessionToSilentExecRequestId.get(sessionId);
  const request = requestId ? pendingSilentExecRequests.get(requestId) : undefined;
  if (!request) {
    if (!pendingPromptSuppressionSessions.has(sessionId)) {
      return chunk;
    }

    const { output, consumedPrompt, keepSuppression } = consumeSuppressedPromptChunk(chunk);
    if (consumedPrompt || !keepSuppression) {
      pendingPromptSuppressionSessions.delete(sessionId);
    }
    return output;
  }

  request.pendingLineBuffer += chunk.replace(/\r/g, '');
  const lines = request.pendingLineBuffer.split('\n');
  request.pendingLineBuffer = lines.pop() || '';
  let overflowOutput = '';

  // 仅对"最后一个未换行残片"做上限控制，避免大包时误伤 marker 所在完整行。
  if (request.pendingLineBuffer.length > MAX_SILENT_LINE_BUFFER_SIZE) {
    const overflowLength = request.pendingLineBuffer.length - MAX_SILENT_LINE_BUFFER_SIZE;
    const overflowChunk = request.pendingLineBuffer.slice(0, overflowLength);
    request.pendingLineBuffer = request.pendingLineBuffer.slice(overflowLength);

    if (request.isCollectingOutput) {
      appendSilentCollectedOutput(request, overflowChunk);
    } else {
      overflowOutput = overflowChunk;
    }
  }
  const visibleLines: string[] = [];
  let completedInThisChunk = false;

  for (const rawLine of lines) {
    const trimmedLine = rawLine.trim();
    const hasStartMarker =
      trimmedLine === request.startMarker || rawLine.includes(request.startMarker);
    const isStartEchoLine = rawLine.includes(`echo ${request.startMarker}`);
    const hasEndMarker = trimmedLine === request.endMarker || rawLine.includes(request.endMarker);
    const isEndEchoLine = rawLine.includes(`echo ${request.endMarker}`);

    if (!request.isCollectingOutput) {
      if (hasStartMarker && !isStartEchoLine) {
        request.isCollectingOutput = true;
        request.collectedOutput = '';
        continue;
      }

      if (isStartEchoLine) {
        continue;
      }

      visibleLines.push(rawLine);
      continue;
    }

    if (hasEndMarker && !isEndEchoLine) {
      const normalizedOutput = request.collectedOutput.replace(/\r/g, '');
      const hasMoreCandidates = request.attemptIndex + 1 < request.commandCandidates.length;
      const isAccepted = isSilentExecOutputAccepted(request.successCriteria, normalizedOutput);

      clearSilentExecTimer(request);
      request.isCollectingOutput = false;
      request.collectedOutput = '';

      if (!isAccepted && hasMoreCandidates) {
        moveToNextSilentExecAttempt(
          sessionId,
          `Command output does not match success criteria: ${request.successCriteria}.`,
        );
        startSilentExecAttempt(sessionId);
      } else {
        completedInThisChunk = true;
        finalizeSilentExecWithResult(sessionId, normalizedOutput);
      }
      continue;
    }

    if (isEndEchoLine) {
      continue;
    }

    if (
      completedInThisChunk &&
      request.suppressTerminalPrompt &&
      isLikelyShellPromptLine(rawLine)
    ) {
      continue;
    }

    appendSilentCollectedOutput(
      request,
      request.collectedOutput.length > 0 ? `\n${rawLine}` : rawLine,
    );
  }

  let visibleOutput = visibleLines.length > 0 ? `${visibleLines.join('\n')}\n` : '';
  if (overflowOutput) {
    visibleOutput += overflowOutput;
  }

  // 如果本次处理过程中请求已结束，补发尚未换行的尾部内容（常见于 shell prompt）。
  const requestStillActive = sessionToSilentExecRequestId.get(sessionId) === request.requestId;
  if (!requestStillActive && request.pendingLineBuffer) {
    const shouldSuppressPendingPrompt =
      request.suppressTerminalPrompt && isLikelyShellPromptLine(request.pendingLineBuffer);
    if (!shouldSuppressPendingPrompt) {
      visibleOutput += request.pendingLineBuffer;
    }
    request.pendingLineBuffer = '';
  }

  return visibleOutput;
};

const normalizeShellFlavor = (value: unknown): SilentExecShellFlavor | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (
    normalized === 'posix' ||
    normalized === 'powershell' ||
    normalized === 'cmd' ||
    normalized === 'fish'
  ) {
    return normalized;
  }
  return undefined;
};

const getSilentExecCommandCandidates = (payload: SilentExecPayload): string[] => {
  if (typeof payload.command === 'string' && payload.command.trim()) {
    return [payload.command.trim()];
  }

  if (!payload.commandsByShell || typeof payload.commandsByShell !== 'object') {
    return [];
  }

  const commandMap = payload.commandsByShell;
  const shellHint = normalizeShellFlavor(payload.shellFlavorHint);
  const candidateKeys: Array<SilentExecShellFlavor | 'default'> = shellHint
    ? [shellHint, 'default']
    : ['posix', 'default', 'fish', 'powershell', 'cmd'];
  const commands = new Set<string>();

  for (const key of candidateKeys) {
    const value = commandMap[key];
    if (typeof value === 'string' && value.trim()) {
      commands.add(value.trim());
    }
  }

  return Array.from(commands);
};

// SSH 静默执行超时默认值（5秒），等待用户配置覆盖
const DEFAULT_SSH_RECONNECT_DELAY_MS = 5000;

const getSilentExecTimeoutMs = (value: unknown): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_SSH_RECONNECT_DELAY_MS;
  }
  return Math.max(1000, Math.min(Math.floor(value), 20000));
};

const sendSilentExecResponse = (
  ws: AuthenticatedWebSocket,
  type: 'ssh:exec_silent:result' | 'ssh:exec_silent:error',
  requestId: string,
  payload: Record<string, unknown>,
  sessionId?: string,
): void => {
  if (ws.readyState !== WebSocket.OPEN) {
    return;
  }
  try {
    ws.send(JSON.stringify({ type, requestId, payload, sid: sessionId ?? ws.sessionId }));
  } catch {
    // 发送失败时静默处理
  }
};

export function handleSshExecSilent(
  ws: AuthenticatedWebSocket,
  rawPayload: unknown,
  requestIdFromMessage?: string,
  overrideSessionId?: string,
): void {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;
  const requestId =
    typeof requestIdFromMessage === 'string' && requestIdFromMessage.trim()
      ? requestIdFromMessage
      : crypto.randomUUID();

  if (!sessionId || !state?.sshClient || !state.sshShellStream || !state.isShellReady) {
    sendSilentExecResponse(
      ws,
      'ssh:exec_silent:error',
      requestId,
      {
        error: 'SSH shell is not ready.',
      },
      sessionId,
    );
    return;
  }

  const payload = (rawPayload || {}) as SilentExecPayload;
  const commandCandidates = getSilentExecCommandCandidates(payload);
  if (commandCandidates.length === 0) {
    sendSilentExecResponse(
      ws,
      'ssh:exec_silent:error',
      requestId,
      {
        error: 'Missing command for silent execution.',
      },
      sessionId,
    );
    return;
  }

  if (sessionToSilentExecRequestId.has(sessionId)) {
    sendSilentExecResponse(
      ws,
      'ssh:exec_silent:error',
      requestId,
      {
        error: 'Another silent command is already in progress.',
      },
      sessionId,
    );
    return;
  }

  const request: PendingSilentExecRequest = {
    ws,
    sessionId,
    requestId,
    commandCandidates,
    timeoutMs: getSilentExecTimeoutMs(payload.timeoutMs),
    successCriteria: normalizeSilentExecSuccessCriteria(payload.successCriteria),
    attemptIndex: 0,
    startMarker: '',
    endMarker: '',
    pendingLineBuffer: '',
    isCollectingOutput: false,
    collectedOutput: '',
    suppressTerminalPrompt: payload.suppressTerminalPrompt === true,
  };

  // H-17: 使用 requestId 作为主键，避免并发请求被覆盖
  pendingSilentExecRequests.set(requestId, request);
  sessionToSilentExecRequestId.set(sessionId, requestId);
  startSilentExecAttempt(sessionId);
}

// H-19: 注册会话级清理回调，在 cleanupClientConnection 中调用，清理 silent exec 定时器
registerSessionCleanup((sessionId: string) => {
  const requestId = sessionToSilentExecRequestId.get(sessionId);
  if (requestId) {
    const request = pendingSilentExecRequests.get(requestId);
    if (request) {
      clearSilentExecTimer(request);
      pendingSilentExecRequests.delete(requestId);
    }
    sessionToSilentExecRequestId.delete(sessionId);
  }
  pendingPromptSuppressionSessions.delete(sessionId);
});

export async function handleSshConnect(
  ws: AuthenticatedWebSocket,
  request: Request,
  payload: SshConnectPayload,
  clientSid?: string,
): Promise<void> {
  const { sessionId } = ws;
  const existingState = sessionId ? clientStates.get(sessionId) : undefined;

  // 多路复用模式：允许同一物理连接创建多个逻辑会话
  // 非多路复用模式：仍保持单会话限制
  if (sessionId && existingState && !clientSid) {
    logger.warn(
      `WebSocket: 用户 ${ws.username} (会话: ${sessionId}) 已有活动连接，忽略新的连接请求。`,
    );
    safeSend(ws, 'ssh:error', '已存在活动的 SSH 连接。', ws.sessionId);
    return;
  }

  const dbConnectionId = payload?.connectionId;
  if (!dbConnectionId) {
    safeSend(ws, 'ssh:error', '缺少 connectionId。', clientSid ?? ws.sessionId);
    return;
  }

  logger.debug(`WebSocket: 用户 ${ws.username} 请求连接到数据库 ID: ${dbConnectionId}`);
  sendWsMessage(ws, 'ssh:status', '正在处理连接请求...', clientSid ?? ws.sessionId);

  // SSH 连接耗时计时器（成功时标记 success，失败时标记 failure）
  const sshConnectTimer = sshConnectDuration.startTimer();

  const dbConnectionIdAsNumber = parseInt(String(dbConnectionId), 10);
  if (Number.isNaN(dbConnectionIdAsNumber)) {
    sshConnectTimer({ status: 'failure' });
    logger.error(`WebSocket: 无效的 dbConnectionId '${dbConnectionId}' (非数字)，无法建立连接。`);
    safeSend(ws, 'ssh:error', '无效的连接 ID。', clientSid ?? ws.sessionId);
    ws.close(1008, 'Invalid Connection ID');
    return;
  }

  const requestWithClientIp = request as Request & { clientIpAddress?: string };
  const clientIp = requestWithClientIp.clientIpAddress || 'unknown';
  let connInfo: SshService.DecryptedConnectionDetails | null = null;

  try {
    if (ws.readyState === WebSocket.OPEN)
      sendWsMessage(ws, 'ssh:status', '正在获取连接信息...', clientSid ?? ws.sessionId);
    connInfo = await SshService.getConnectionDetails(dbConnectionIdAsNumber);
    if (!connInfo) {
      throw new Error(`未找到连接信息（ID: ${dbConnectionIdAsNumber}）`);
    }

    if (ws.readyState === WebSocket.OPEN)
      sendWsMessage(ws, 'ssh:status', `正在连接到 ${connInfo.host}...`, clientSid ?? ws.sessionId);
    const sshClient = await SshService.establishSshConnection(connInfo);

    // SSH 连接已建立，TCP_NODELAY 将通过连接配置自动应用

    const newSessionId = crypto.randomUUID();
    ws.sessionId = newSessionId; // Assign new sessionId to the WebSocket

    const newState: ClientState = {
      ws,
      sshClient,
      dbConnectionId: dbConnectionIdAsNumber,
      connectionName: connInfo.name,
      connectedAt: Math.floor(Date.now() / 1000),
      ipAddress: clientIp,
      isShellReady: false,
    };
    clientStates.set(newSessionId, newState);
    // 多路复用模式：注册逻辑通道到物理连接
    registerChannel(ws, newSessionId);
    logger.debug(
      `WebSocket: 为用户 ${ws.username} (IP: ${clientIp}) 创建新会话 ${newSessionId} (DB ID: ${dbConnectionIdAsNumber}, 连接名称: ${newState.connectionName})`,
    );

    // 发送路由规划信息（跳板链路可视化）
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const routePlan = (sshClient as any)._routePlan;
    // 握手阶段：使用 clientSid 确保前端临时通道能接收
    const handshakeSid = clientSid ?? newSessionId;
    if (routePlan && ws.readyState === WebSocket.OPEN) {
      sendWsMessage(ws, 'ssh:route_plan', routePlan, handshakeSid);
    }

    sendWsMessage(ws, 'ssh:status', 'SSH 连接成功，正在打开 Shell...', handshakeSid);
    try {
      const defaultCols = payload?.cols || 80; // Use provided cols or default
      const defaultRows = payload?.rows || 24; // Use provided rows or default
      // H-21: Shell 就绪超时保护，防止 shell 挂起导致无限等待
      let shellCallbackCalled = false;
      const shellReadyTimeout = setTimeout(() => {
        if (!shellCallbackCalled) {
          shellCallbackCalled = true;
          sshConnectTimer({ status: 'failure' });
          logger.error(`SSH: 会话 ${newSessionId} Shell 就绪超时（${SHELL_READY_TIMEOUT_MS}ms）。`);
          sendWsMessage(ws, 'ssh:error', 'Shell 就绪超时，请重试。', handshakeSid);
          cleanupClientConnection(newSessionId).catch((error: unknown) => {
            logger.debug(
              '[WebSocket] Shell 就绪超时清理连接失败:',
              error instanceof Error ? error.message : error,
            );
          });
        }
      }, SHELL_READY_TIMEOUT_MS);

      sshClient.shell(
        {
          term: payload?.term || 'xterm-256color',
          cols: defaultCols,
          rows: defaultRows,
        },
        (err, stream) => {
          clearTimeout(shellReadyTimeout);
          if (shellCallbackCalled) return; // 超时已处理，忽略后续回调
          shellCallbackCalled = true;
          if (err) {
            sshConnectTimer({ status: 'failure' });
            logger.error(`SSH: 会话 ${newSessionId} 打开 Shell 失败:`, err);
            const shellFailPayload: Record<string, unknown> = {
              connectionName: newState.connectionName,
              userId: ws.userId,
              username: ws.username,
              connectionId: dbConnectionIdAsNumber,
              sessionId: newSessionId,
              ip: newState.ipAddress,
              reason: err.message,
            };
            void lookupGeoInfo(newState.ipAddress)
              .then((geoInfo) => {
                if (geoInfo) shellFailPayload.geoInfo = geoInfo;
              })
              .finally(() => {
                auditLogService.logAction('SSH_SHELL_FAILURE', shellFailPayload);
                notificationService.sendNotification('SSH_SHELL_FAILURE', shellFailPayload);
              });
            eventService.emitEvent(AppEventType.SshShellFailure, {
              userId: ws.userId,
              details: {
                connectionId: dbConnectionIdAsNumber,
                connectionName: newState.connectionName || '',
                sessionId: newSessionId,
                ip: clientIp,
                reason: getErrorMessage(err),
              },
            });
            sendWsMessage(ws, 'ssh:error', `打开 Shell 失败: ${err.message}`, handshakeSid);
            cleanupClientConnection(newSessionId).catch((error: unknown) => {
              logger.debug(
                '[WebSocket] Shell 打开失败后清理连接失败:',
                error instanceof Error ? error.message : error,
              );
            });
            return;
          }

          logger.debug(
            `WebSocket: 会话 ${newSessionId} Shell 打开成功 (尺寸 ${defaultCols}x${defaultRows})。`,
          );
          newState.sshShellStream = stream;
          newState.isShellReady = true;

          // 创建输出批处理器，将 16ms 窗口内的多个 SSH 输出块合并为单帧
          const outputBatcher = getOrCreateBatcher(ws, newSessionId, (encoded: string) => {
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(
                JSON.stringify({
                  type: 'ssh:output',
                  payload: encoded,
                  encoding: 'base64',
                  sid: newSessionId,
                }),
              );
            }
          });

          stream.on('data', (data: Buffer) => {
            const processedOutput = processSshStreamOutput(newSessionId, data.toString('utf8'));
            if (processedOutput) {
              // 使用批处理器合并小数据块，降低帧数和带宽占用
              outputBatcher.write(processedOutput);
            }
            // 如果会话被标记为待挂起，则将输出写入日志
            const currentState = clientStates.get(newSessionId); // 获取最新的状态
            if (
              processedOutput &&
              currentState?.isMarkedForSuspend &&
              currentState.suspendLogPath
            ) {
              temporaryLogStorageService
                .writeToLog(currentState.suspendLogPath, processedOutput)
                .catch((writeLogError: unknown) => {
                  logger.error(
                    `[SSH Handler] 写入标记会话 ${newSessionId} 的日志失败 (路径: ${currentState.suspendLogPath}):`,
                    writeLogError,
                  );
                });
            }
          });
          stream.stderr.on('data', (data: Buffer) => {
            const processedOutput = processSshStreamOutput(newSessionId, data.toString('utf8'));
            if (processedOutput) {
              logger.error(
                `SSH Stderr (会话: ${newSessionId})，数据长度: ${processedOutput.length}`,
              );
              // stderr 也通过批处理器发送，保持一致性
              outputBatcher.write(processedOutput);
            }
            // 同样，如果会话被标记为待挂起，则将 stderr 输出写入日志
            const currentState = clientStates.get(newSessionId);
            if (
              processedOutput &&
              currentState?.isMarkedForSuspend &&
              currentState.suspendLogPath
            ) {
              temporaryLogStorageService
                .writeToLog(currentState.suspendLogPath, `[STDERR] ${processedOutput}`)
                .catch((writeStderrLogError: unknown) => {
                  logger.error(
                    `[SSH Handler] 写入标记会话 ${newSessionId} 的 STDERR 日志失败 (路径: ${currentState.suspendLogPath}):`,
                    writeStderrLogError,
                  );
                });
            }
          });
          stream.on('close', () => {
            // 销毁批处理器，刷新剩余数据并释放资源
            destroyBatcher(newSessionId);
            finalizeSilentExecWithError(
              newSessionId,
              'Shell channel closed before silent command completed.',
            );
            logger.debug(`SSH: 会话 ${newSessionId} 的 Shell 通道已关闭。`);
            sendWsMessage(ws, 'ssh:disconnected', 'Shell 通道已关闭。', newSessionId);
            cleanupClientConnection(newSessionId).catch((error: unknown) => {
              logger.debug(
                '[WebSocket] Shell 通道关闭后清理连接失败:',
                error instanceof Error ? error.message : error,
              );
            });
          });

          // SSH 连接成功，记录连接耗时指标
          sshConnectTimer({ status: 'success' });

          // SSH 连接成功，追加 connectionId 和 protocol 到日志上下文
          withLogContext({ connectionId: dbConnectionIdAsNumber, protocol: 'ssh' }, () => {
            logger.info(`WebSocket: 会话 ${newSessionId} SSH 连接和 Shell 建立成功。`);
          });

          if (ws.readyState === WebSocket.OPEN)
            ws.send(
              JSON.stringify({
                type: 'ssh:connected',
                payload: {
                  connectionId: dbConnectionIdAsNumber,
                  sessionId: newSessionId,
                  // 多路复用：前端用于重映射通道 key
                  backendSessionId: newSessionId,
                },
                // 多路复用模式：用客户端 SID 回复，确保前端通道能匹配
                // 非多路复用模式：clientSid 为 undefined，使用 newSessionId
                sid: clientSid ?? newSessionId,
              }),
            );
          const connectSuccessPayload: Record<string, unknown> = {
            userId: ws.userId,
            username: ws.username,
            connectionId: dbConnectionIdAsNumber,
            sessionId: newSessionId,
            ip: newState.ipAddress,
            connectionName: newState.connectionName,
          };
          void lookupGeoInfo(newState.ipAddress)
            .then((geoInfo) => {
              if (geoInfo) connectSuccessPayload.geoInfo = geoInfo;
            })
            .finally(() => {
              auditLogService.logAction('SSH_CONNECT_SUCCESS', connectSuccessPayload);
              notificationService.sendNotification('SSH_CONNECT_SUCCESS', connectSuccessPayload);
            });
          eventService.emitEvent(AppEventType.SshConnectSuccess, {
            userId: ws.userId,
            details: {
              connectionId: dbConnectionIdAsNumber,
              connectionName: newState.connectionName || '',
              sessionId: newSessionId,
              ip: clientIp,
            },
          });

          logger.debug(`WebSocket: 会话 ${newSessionId} 正在异步初始化 SFTP...`);
          sftpService
            .initializeSftpSession(newSessionId)
            .then(() => logger.debug(`SFTP: 会话 ${newSessionId} 异步初始化成功。`))
            .catch((sftpInitError: unknown) =>
              logger.error(`WebSocket: 会话 ${newSessionId} 异步初始化 SFTP 失败:`, sftpInitError),
            );

          statusMonitorService.startStatusPolling(newSessionId);
          startDockerStatusPolling(newSessionId); // Start Docker polling
        },
      );
    } catch (shellError: unknown) {
      const shellErrMsg = getErrorMessage(shellError);
      logger.error(`SSH: 会话 ${newSessionId} 打开 Shell 时发生意外错误: ${shellErrMsg}`);
      if (ws.readyState === WebSocket.OPEN) {
        sendWsMessage(ws, 'ssh:error', `打开 Shell 时发生意外错误: ${shellErrMsg}`, handshakeSid);
      }
      cleanupClientConnection(newSessionId).catch((error: unknown) => {
        logger.debug(
          '[WebSocket] Shell 打开异常后清理连接失败:',
          error instanceof Error ? error.message : error,
        );
      });
    }

    sshClient.on('close', () => {
      finalizeSilentExecWithError(
        newSessionId,
        'SSH connection closed before silent command completed.',
      );
      logger.debug(`SSH: 会话 ${newSessionId} 的客户端连接已关闭。`);
      cleanupClientConnection(newSessionId).catch((error: unknown) => {
        logger.debug(
          '[WebSocket] SSH 客户端关闭后清理连接失败:',
          error instanceof Error ? error.message : error,
        );
      });
    });
    sshClient.on('error', (err: Error) => {
      finalizeSilentExecWithError(
        newSessionId,
        `SSH client error before silent command completed: ${err.message}`,
      );
      logger.error(`SSH: 会话 ${newSessionId} 的客户端连接错误:`, err);
      sendWsMessage(ws, 'ssh:error', `SSH 连接错误: ${err.message}`, newSessionId);
      cleanupClientConnection(newSessionId).catch((error: unknown) => {
        logger.debug(
          '[WebSocket] SSH 客户端错误后清理连接失败:',
          error instanceof Error ? error.message : error,
        );
      });
    });
  } catch (connectError: unknown) {
    const connectErrMsg = getErrorMessage(connectError);
    logger.error(
      `WebSocket: 用户 ${ws.username} (IP: ${clientIp}) 连接到数据库 ID ${dbConnectionId} 失败:`,
      connectError,
    );
    const connectFailPayload: Record<string, unknown> = {
      userId: ws.userId,
      username: ws.username,
      connectionId: dbConnectionId,
      connectionName: connInfo?.name || 'Unknown',
      ip: clientIp,
      reason: connectErrMsg,
    };
    void lookupGeoInfo(clientIp)
      .then((geoInfo) => {
        if (geoInfo) connectFailPayload.geoInfo = geoInfo;
      })
      .finally(() => {
        auditLogService.logAction('SSH_CONNECT_FAILURE', connectFailPayload);
        notificationService.sendNotification('SSH_CONNECT_FAILURE', connectFailPayload);
      });
    // SSH 连接失败，记录连接耗时指标
    sshConnectTimer({ status: 'failure' });

    eventService.emitEvent(AppEventType.SshConnectFailure, {
      userId: ws.userId,
      details: {
        connectionId: payload.connectionId,
        connectionName: connInfo?.name || '',
        sessionId: ws.sessionId,
        ip: clientIp,
        reason: connectErrMsg,
      },
    });
    if (ws.readyState === WebSocket.OPEN)
      sendWsMessage(ws, 'ssh:error', `连接失败: ${connectErrMsg}`, clientSid ?? ws.sessionId);
    // 多路复用模式下不关闭物理 WebSocket，仅发送错误到当前通道
    if (!ws.isMultiplex || !isMultiplexEnabled()) {
      ws.close(1011, `SSH Connection Failed: ${connectErrMsg}`);
    }
  }
}

export function handleSshInput(
  ws: AuthenticatedWebSocket,
  payload: SshInputPayload,
  overrideSessionId?: string,
): void {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;

  if (!state || !state.sshShellStream) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的 SSH 输入，但无活动 Shell。`,
    );
    return;
  }
  const data = resolveSshInputData(payload);
  if (typeof data === 'string' && state.isShellReady) {
    state.sshShellStream.write(data);
  } else if (!state.isShellReady) {
    logger.warn(`WebSocket: 会话 ${sessionId} 收到 SSH 输入，但 Shell 尚未就绪。`);
  }
}

export function handleSshResize(
  ws: AuthenticatedWebSocket,
  payload: SshResizePayload,
  overrideSessionId?: string,
): void {
  const sessionId = overrideSessionId ?? ws.sessionId;
  const state = sessionId ? clientStates.get(sessionId) : undefined;

  if (!state || !state.sshClient) {
    // sshClient is enough, stream might not be ready for resize yet
    logger.warn(`WebSocket: 收到来自 ${ws.username} 的调整大小请求，但无有效会话或 SSH 客户端。`);
    return;
  }

  const { cols, rows } = payload || {};
  if (!isValidSshResizeDims(cols, rows)) {
    logger.warn(
      `WebSocket: 收到来自 ${ws.username} (会话: ${sessionId}) 的无效调整大小请求:`,
      payload,
    );
    return;
  }

  // isValidSshResizeDims 已保证为合法正整数
  const safeCols = cols as number;
  const safeRows = rows as number;

  if (state.isShellReady && state.sshShellStream) {
    logger.debug(`SSH: 会话 ${sessionId} 调整终端大小: ${safeCols}x${safeRows}`);
    state.sshShellStream.setWindow(safeRows, safeCols, 0, 0);
  } else {
    // Store intended size if shell not ready, apply when shell is ready.
    // This part is a bit more complex as it requires modifying the shell opening logic.
    // For now, we just log if shell is not ready.
    logger.warn(
      `WebSocket: 会话 ${sessionId} 收到调整大小请求，但 Shell 尚未就绪或流不存在 (isShellReady: ${state.isShellReady})。尺寸将不会立即应用。`,
    );
    // A more robust solution would queue the resize or store it in ClientState to be applied later.
  }
}

// 处理会话恢复后的状态监控启动
export function handleSshResumeSuccess(sessionId: string): void {
  const state = clientStates.get(sessionId);
  if (state && state.sshClient) {
    // 多路复用模式：将恢复的会话注册到物理连接的通道集合中
    registerChannel(state.ws, sessionId);
    statusMonitorService.startStatusPolling(sessionId);
  } else {
    logger.error(
      `[SSH Handler ${sessionId}] 无法为恢复的会话启动状态轮询：未找到会话状态或 SSH 客户端。`,
    );
  }
}
