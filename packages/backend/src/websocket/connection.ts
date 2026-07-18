import WebSocket, { WebSocketServer, RawData } from 'ws';
import { Request } from 'express';
import { getErrorMessage } from '../utils/AppError';
import {
  AuthenticatedWebSocket,
  SshSuspendResumeRequest,
  SshSuspendTerminateRequest,
  SshSuspendRemoveEntryRequest,
  // SshSuspendEditNameRequest, // Removed as it's now HTTP
  SshSuspendListResponse,
  SshSuspendResumedNotification,
  SshOutputCachedChunk,
  SshSuspendTerminatedResponse,
  SshSuspendEntryRemovedResponse,
  // SshSuspendNameEditedResponse, // Removed as it's now HTTP
  SshSuspendAutoTerminatedNotification,
  SshMarkForSuspendRequest,
  SshMarkedForSuspendAck,
  SshUnmarkForSuspendRequest,
  SshUnmarkedForSuspendAck,
  ClientState,
} from './types';
import { SshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { SftpService } from '../sftp/sftp.service';
import { cleanupClientConnection } from './utils';
import { clientStates, registerUserSocket, unregisterUserSocket, transportChannels } from './state'; // 导入 userId 映射函数和通道追踪
import { temporaryLogStorageService } from '../ssh-suspend/temporary-log-storage.service';
import { resetHeartbeat, cleanupHeartbeat } from './heartbeat'; // 导入心跳函数
import { validateWebSocketMessage, isLikelyValidJson } from './validate'; // 导入消息校验函数
import {
  createMultiplexTransport,
  registerTransport,
  unregisterTransport,
  isMultiplexEnabled,
  MultiplexTransport,
} from './multiplex'; // 导入多路复用模块
import { destroyBatcher } from './output-batcher'; // 导入批处理器
import { checkRateLimit, cleanupRateLimit } from './rate-limiter'; // 导入速率限制器
import {
  detectClientType,
  getConnectionRequestMeta,
  getRateLimitKey,
  isClientType,
} from './connection-meta';

// Handlers
import { handleRdpProxyConnection } from './handlers/remote-desktop.handler';
import {
  handleSshConnect,
  handleSshInput,
  handleSshResize,
  handleSshResumeSuccess,
  handleSshExecSilent,
} from './handlers/ssh.handler';
import {
  handleDockerGetStatus,
  handleDockerCommand,
  handleDockerGetStats,
} from './handlers/docker.handler';
import {
  handleSftpOperation,
  handleSftpUploadStart,
  handleSftpUploadChunk,
  handleSftpUploadCancel,
} from './handlers/sftp.handler';
// Telnet handlers
import {
  handleTelnetConnect,
  handleTelnetInput,
  handleTelnetResize,
  handleTelnetDisconnect,
} from '../telnet/telnet.handler';
import { logger } from '../utils/logger';
import { withLogContext } from '../middleware/log-context.middleware';

export function initializeConnectionHandler(
  wss: WebSocketServer,
  sshSuspendService: SshSuspendService,
  sftpService: SftpService,
): void {
  // +++ Add sftpService parameter +++
  wss.on('connection', (ws: AuthenticatedWebSocket, request: Request) => {
    // 初始化心跳状态
    ws.missedPongCount = 0;
    ws.isAlive = true; // 向后兼容

    // 检测客户端类型（从请求头或查询参数）
    const userAgent = request.headers['user-agent'] || '';
    const {
      clientType: clientTypeParam,
      isRdpProxy,
      isWebRTCSignaling,
      clientIpAddress,
    } = getConnectionRequestMeta(request);

    // 规范化参数（去空格、小写）
    const normalizedClientType = clientTypeParam
      ? String(clientTypeParam).trim().toLowerCase()
      : null;

    const isValidClientType = isClientType(normalizedClientType);

    // 记录被拒绝的客户端类型值（用于审计与灰度）
    if (clientTypeParam && !isValidClientType) {
      logger.warn(
        `[WebSocket] 拒绝无效的客户端类型参数: "${clientTypeParam}"（规范化后: "${normalizedClientType}"），已回退到 UA 检测。`,
      );
    }

    ws.clientType = isValidClientType
      ? (normalizedClientType as 'desktop' | 'mobile')
      : detectClientType(userAgent);

    const clientIp = typeof clientIpAddress === 'string' ? clientIpAddress : 'unknown'; // Preserved from upgrade handler

    logger.debug(
      `WebSocket：客户端 ${ws.username} (ID: ${ws.userId}, IP: ${clientIp}, 类型: ${ws.clientType}, RDP Proxy: ${isRdpProxy}) 已连接。`,
    );

    // 注册 userId 到 WebSocket 的映射（支持广播功能）
    if (ws.userId) {
      registerUserSocket(ws.userId, ws);
    }

    // 使用新的心跳重置函数
    ws.on('pong', () => {
      resetHeartbeat(ws);
    });

    // 多路复用模式：创建传输管理器
    let multiplexTransport: MultiplexTransport | null = null;
    if (ws.isMultiplex && isMultiplexEnabled()) {
      multiplexTransport = createMultiplexTransport(ws);
      registerTransport(ws, multiplexTransport);
      logger.info(`[WebSocket] 多路复用传输已创建 (用户: ${ws.username}, ID: ${ws.userId})`);
    }

    // WebRTC 信令连接处理
    if (isWebRTCSignaling) {
      // 动态导入避免循环依赖
      import('../webrtc/signaling.js')
        .then(({ handleSignalingConnectionRequest }) => {
          handleSignalingConnectionRequest(ws);
        })
        .catch((err) => {
          logger.error('[WebSocket] 加载 WebRTC 信令模块失败:', err);
          ws.close(1011, 'WebRTC signaling module load failed');
        });

      // 信令连接的 close/error 清理：注销 userSocketsMap 防止内存泄漏
      ws.on('close', () => {
        if (ws.userId) {
          unregisterUserSocket(ws.userId, ws);
        }
        logger.debug(`[WebSocket] WebRTC 信令连接已断开 (用户: ${ws.userId})`);
      });

      ws.on('error', (error) => {
        logger.error(`[WebSocket] WebRTC 信令连接错误 (用户: ${ws.userId}):`, error);
        if (ws.userId) {
          unregisterUserSocket(ws.userId, ws);
        }
      });

      return;
    }

    if (isRdpProxy) {
      handleRdpProxyConnection(ws, request);
    } else {
      // Standard SSH/SFTP/Docker connection
      ws.on('message', async (message: RawData) => {
        const rawStr = message.toString();

        // 将 userId、username、sessionId 注入日志上下文，后续所有日志自动携带
        const wsUserId = ws.userId;
        const wsUsername = ws.username;
        const wsSessionId = ws.sessionId;

        // 包裹整个消息处理链，确保所有下游 logger 调用自动携带上下文
        return withLogContext(
          { userId: wsUserId, username: wsUsername, sessionId: wsSessionId },
          async () => {
            // 快速预检：跳过明显非 JSON 对象的载荷（避免昂贵的 JSON.parse）
            if (!isLikelyValidJson(rawStr)) {
              logger.debug(`WebSocket：来自 ${ws.username} 的非 JSON 载荷，已跳过`);
              if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
              return;
            }

            let parsedMessage: unknown;
            try {
              parsedMessage = JSON.parse(rawStr);
            } catch (err: unknown) {
              logger.debug({ err }, '操作失败，已忽略');
              logger.error(`WebSocket：来自 ${ws.username} 的无效 JSON 消息:`, message.toString());
              if (ws.readyState === WebSocket.OPEN)
                ws.send(JSON.stringify({ type: 'error', payload: '无效的消息格式 (非 JSON)' }));
              return;
            }

            // --- 统一 Schema 校验（P1-3 安全改进）---
            const validationResult = validateWebSocketMessage(parsedMessage);
            if (!validationResult.success) {
              logger.warn(
                `[WebSocket 校验] 来自 ${ws.username} 的消息校验失败: ${validationResult.error}`,
              );
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    payload: validationResult.error,
                  }),
                );
              }
              return;
            }

            // 使用已校验的消息数据
            const { type, payload, requestId } = validationResult.data;

            // 速率限制检查：防止恶意客户端高频消息导致 DoS
            const rateLimitSessionId = getRateLimitKey(ws);
            if (!checkRateLimit(rateLimitSessionId, type)) {
              if (ws.readyState === WebSocket.OPEN) {
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    payload: `消息频率超过限制，请稍后重试 (${type})`,
                  }),
                );
              }
              return;
            }
            // 多路复用模式：仅在启用时从消息中提取 sid，并校验所有权
            let effectiveSessionId = ws.sessionId;
            if (isMultiplexEnabled() && ws.isMultiplex) {
              const msgSid = (parsedMessage as Record<string, unknown>)?.sid as string | undefined;
              if (msgSid) {
                // ssh:connect 和 SSH_SUSPEND_RESUME_REQUEST 是创建会话的消息，
                // 客户端临时 SID 不在 clientStates 中，直接使用 msgSid 作为 effectiveSessionId
                if (type === 'ssh:connect' || type === 'SSH_SUSPEND_RESUME_REQUEST') {
                  effectiveSessionId = msgSid;
                } else {
                  // 非 connect 消息：校验 sid 已存在于 clientStates
                  const targetState = clientStates.get(msgSid);
                  if (targetState && targetState.ws.userId === ws.userId) {
                    // 通道成员校验：确认该 sid 注册在当前物理连接的通道中
                    const myChannels = transportChannels.get(ws);
                    if (myChannels && myChannels.has(msgSid)) {
                      effectiveSessionId = msgSid;
                    } else {
                      // 同用户但不属于当前物理连接的通道
                      logger.warn(
                        `[WebSocket 安全] 用户 ${ws.userId} 尝试通过非所属物理连接访问会话 ${msgSid}，已拒绝`,
                      );
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                          JSON.stringify({
                            type: 'error',
                            payload: '该会话不属于当前连接',
                            sid: msgSid,
                          }),
                        );
                      }
                      return;
                    }
                  } else if (targetState) {
                    // 会话存在但不属于当前用户
                    logger.warn(
                      `[WebSocket 安全] 用户 ${ws.userId} 尝试访问不属于自己的会话 ${msgSid}，已拒绝`,
                    );
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({ type: 'error', payload: '无权访问该会话', sid: msgSid }),
                      );
                    }
                    return;
                  } else {
                    // 会话不存在（已清理或 sid 错误），拒绝而非静默回退
                    logger.warn(`[WebSocket 多路复用] sid ${msgSid} 不存在，拒绝请求`);
                    if (ws.readyState === WebSocket.OPEN) {
                      ws.send(
                        JSON.stringify({ type: 'error', payload: '会话不存在', sid: msgSid }),
                      );
                    }
                    return;
                  }
                }
              }
            }

            try {
              switch (type) {
                // SSH Cases
                case 'ssh:connect':
                  // Pass the original Express request object for IP and session
                  // 多路复用模式：传递客户端 SID 用于握手响应
                  await handleSshConnect(
                    ws,
                    request,
                    payload as Parameters<typeof handleSshConnect>[2],
                    effectiveSessionId,
                  );
                  break;
                case 'ssh:input':
                  handleSshInput(
                    ws,
                    payload as Parameters<typeof handleSshInput>[1],
                    effectiveSessionId,
                  );
                  break;
                case 'ssh:resize':
                  handleSshResize(
                    ws,
                    payload as Parameters<typeof handleSshResize>[1],
                    effectiveSessionId,
                  );
                  break;
                case 'ssh:exec_silent':
                  handleSshExecSilent(ws, payload, requestId, effectiveSessionId);
                  break;

                // Telnet Cases
                case 'telnet:connect':
                  await handleTelnetConnect(
                    ws,
                    payload as Parameters<typeof handleTelnetConnect>[1],
                    {
                      clientIpAddress: ws.clientIpAddress,
                    },
                  );
                  break;
                case 'telnet:input':
                  handleTelnetInput(ws, payload as Parameters<typeof handleTelnetInput>[1]);
                  break;
                case 'telnet:resize':
                  handleTelnetResize(ws, payload as Parameters<typeof handleTelnetResize>[1]);
                  break;
                case 'telnet:disconnect':
                  await handleTelnetDisconnect(
                    ws,
                    payload as Parameters<typeof handleTelnetDisconnect>[1],
                  );
                  break;

                // Docker Cases
                case 'docker:get_status':
                  await handleDockerGetStatus(ws, effectiveSessionId);
                  break;
                case 'docker:command':
                  await handleDockerCommand(ws, effectiveSessionId, payload);
                  break;
                case 'docker:get_stats':
                  await handleDockerGetStats(ws, effectiveSessionId, payload);
                  break;

                // SFTP Cases (generic operations)
                case 'sftp:readdir':
                case 'sftp:stat':
                case 'sftp:readfile':
                case 'sftp:writefile':
                case 'sftp:mkdir':
                case 'sftp:rmdir':
                case 'sftp:unlink':
                case 'sftp:rename':
                case 'sftp:chmod':
                case 'sftp:realpath':
                case 'sftp:copy':
                case 'sftp:move':
                case 'sftp:compress':
                case 'sftp:decompress':
                  await handleSftpOperation(
                    ws,
                    type,
                    payload as Parameters<typeof handleSftpOperation>[2],
                    requestId,
                    effectiveSessionId,
                  );
                  break;

                // SFTP Upload Cases
                case 'sftp:upload:start':
                  handleSftpUploadStart(
                    ws,
                    payload as Parameters<typeof handleSftpUploadStart>[1],
                    effectiveSessionId,
                  );
                  break;
                case 'sftp:upload:chunk':
                  await handleSftpUploadChunk(
                    ws,
                    payload as Parameters<typeof handleSftpUploadChunk>[1],
                    effectiveSessionId,
                  );
                  break;
                case 'sftp:upload:cancel':
                  handleSftpUploadCancel(
                    ws,
                    payload as Parameters<typeof handleSftpUploadCancel>[1],
                    effectiveSessionId,
                  );
                  break;

                // --- 多路复用通道关闭 ---
                case 'session:close':
                  // 前端关闭多路复用通道时通知后端清理资源
                  cleanupClientConnection(effectiveSessionId).catch((error: unknown) => {
                    logger.debug(
                      `[WebSocket] 多路复用通道关闭清理失败 (${effectiveSessionId}):`,
                      error instanceof Error ? error.message : error,
                    );
                  });
                  break;

                // --- SSH Suspend Cases ---

                case 'SSH_SUSPEND_LIST_REQUEST': {
                  if (!ws.userId) {
                    logger.error(`[SSH_SUSPEND_LIST_REQUEST] 用户 ID 未定义。`);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_LIST_RESPONSE',
                          payload: { suspendSessions: [] },
                        }),
                      ); // 返回空列表或错误
                    break;
                  }
                  try {
                    const sessions = await sshSuspendService.listSuspendedSessions(ws.userId);
                    const response: SshSuspendListResponse = {
                      type: 'SSH_SUSPEND_LIST_RESPONSE',
                      payload: { suspendSessions: sessions },
                    };
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                  } catch (error: unknown) {
                    logger.error(`[SSH_SUSPEND_LIST_REQUEST] 获取挂起列表失败:`, error);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_LIST_RESPONSE',
                          payload: { suspendSessions: [] },
                        }),
                      ); // 返回空列表或错误
                  }
                  break;
                }
                case 'SSH_SUSPEND_RESUME_REQUEST': {
                  const resumePayload = payload as SshSuspendResumeRequest['payload'];
                  const { suspendSessionId, newFrontendSessionId } = resumePayload;
                  // logger.info(`[WebSocket Handler][${type}] 接到请求。UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, Payload: ${JSON.stringify(resumePayload)}`);

                  if (!ws.userId) {
                    logger.error(`[WebSocket Handler][${type}] 用户 ID 未定义。`);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_RESUMED',
                          payload: {
                            suspendSessionId,
                            newFrontendSessionId,
                            success: false,
                            error: '用户认证失败',
                          },
                        }),
                      );
                    break;
                  }
                  try {
                    // logger.info(`[WebSocket Handler][${type}] 调用 sshSuspendService.resumeSession (userId: ${ws.userId}, suspendSessionId: ${suspendSessionId})`);
                    const result = await sshSuspendService.resumeSession(
                      ws.userId,
                      suspendSessionId,
                    );
                    // logger.info(`[WebSocket Handler][${type}] sshSuspendService.resumeSession 返回: ${result ? `包含 sshClient: ${!!result.sshClient}, channel: ${!!result.channel}, logData长度: ${result.logData?.length}` : 'null'}`);

                    if (result) {
                      // logger.info(`[WebSocket Handler][${type}] 成功恢复会话。准备设置新的 ClientState (ID: ${newFrontendSessionId})。`);
                      const newSessionState: ClientState = {
                        ws, // 当前的 WebSocket 连接
                        sshClient: result.sshClient,
                        sshShellStream: result.channel,
                        dbConnectionId: parseInt(result.originalConnectionId, 10), // 从结果中恢复并转换为数字
                        connectionName: result.connectionName, // 从结果中恢复
                        ipAddress: clientIp,
                        isShellReady: true, // 假设恢复后 Shell 立即可用
                      };
                      clientStates.set(newFrontendSessionId, newSessionState);
                      ws.sessionId = newFrontendSessionId; // 将当前 ws 与新会话关联
                      // logger.info(`[WebSocket Handler][${type}] 新 ClientState (ID: ${newFrontendSessionId}) 已设置并关联到当前 WebSocket。`);

                      // +++ 为恢复的会话初始化 SFTP +++
                      // logger.info(`[WebSocket Handler][${type}] 尝试为恢复的会话 ${newFrontendSessionId} 初始化 SFTP。`);
                      sftpService
                        .initializeSftpSession(newFrontendSessionId)
                        .then(() => {
                          // logger.info(`[WebSocket Handler][${type}] SFTP 初始化调用完成 (可能异步) for ${newFrontendSessionId}。`);
                          // sftp_ready 消息会由 sftpService 内部发送
                        })
                        .catch((sftpInitErr: unknown) => {
                          logger.error(
                            `[WebSocket Handler][${type}] 为恢复的会话 ${newFrontendSessionId} 初始化 SFTP 失败:`,
                            sftpInitErr,
                          );
                          // 即使 SFTP 初始化失败，SSH 会话仍然恢复
                        });
                      // +++ 结束 SFTP 初始化 +++

                      // 重新设置事件监听器，将数据流导向新的前端会话
                      result.channel.removeAllListeners('data'); // 清除 SshSuspendService 可能设置的监听器
                      result.channel.on('data', (data: Buffer) => {
                        if (ws.readyState === WebSocket.OPEN) {
                          // logger.debug(`[WebSocket Handler][${type}] 发送 ssh:output for ${newFrontendSessionId}`);
                          // 保持与 ssh.handler.ts 中 ssh:output 格式一致
                          ws.send(
                            JSON.stringify({
                              type: 'ssh:output',
                              payload: data.toString('base64'),
                              encoding: 'base64',
                            }),
                          );
                        }
                      });
                      result.channel.on('close', () => {
                        logger.debug(
                          `[WebSocket Handler][${type}] 恢复的会话 ${newFrontendSessionId} 的 channel 已关闭。`,
                        );
                        if (ws.readyState === WebSocket.OPEN) {
                          ws.send(
                            JSON.stringify({
                              type: 'ssh:disconnected',
                              payload: { sessionId: newFrontendSessionId },
                            }),
                          );
                        }
                        cleanupClientConnection(newFrontendSessionId).catch((error: unknown) => {
                          logger.debug(
                            '[WebSocket] 恢复会话 channel 关闭后清理失败:',
                            error instanceof Error ? error.message : error,
                          );
                        });
                      });
                      result.sshClient.on('error', (err: Error) => {
                        logger.error(
                          `[WebSocket Handler][${type}] 恢复后的 SSH 客户端错误 (会话: ${newFrontendSessionId}):`,
                          err,
                        );
                        if (ws.readyState === WebSocket.OPEN)
                          ws.send(
                            JSON.stringify({
                              type: 'ssh:error',
                              payload: { sessionId: newFrontendSessionId, error: err.message },
                            }),
                          );
                        cleanupClientConnection(newFrontendSessionId).catch((error: unknown) => {
                          logger.debug(
                            '[WebSocket] 恢复会话 SSH 客户端错误后清理失败:',
                            error instanceof Error ? error.message : error,
                          );
                        });
                      });
                      // logger.info(`[WebSocket Handler][${type}] 已为恢复的会话 ${newFrontendSessionId} 设置事件监听器。`);

                      // 发送缓存日志块
                      logger.debug(
                        `[SSH Suspend Backend] 发送缓存日志块，数据长度: ${result.logData?.length ?? 0}`,
                      );
                      const logChunkResponse: SshOutputCachedChunk = {
                        type: 'SSH_OUTPUT_CACHED_CHUNK',
                        payload: {
                          frontendSessionId: newFrontendSessionId,
                          data: result.logData,
                          isLastChunk: true,
                        },
                      };
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(JSON.stringify({ ...logChunkResponse, sid: newFrontendSessionId }));
                        // logger.info(`[WebSocket Handler][${type}] 已发送 SSH_OUTPUT_CACHED_CHUNK 给 ${newFrontendSessionId} (数据长度: ${result.logData.length})。`);
                      } else {
                        // logger.warn(`[WebSocket Handler][${type}] WebSocket 在发送 SSH_OUTPUT_CACHED_CHUNK 前已关闭 (会话 ${newFrontendSessionId})。`);
                      }

                      // +++ 发送 ssh:connected 消息 +++
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                          JSON.stringify({
                            type: 'ssh:connected',
                            payload: {
                              connectionId: newSessionState.dbConnectionId, // 使用已恢复的 dbConnectionId
                              sessionId: newFrontendSessionId, // 使用新的前端会话 ID
                            },
                            sid: newFrontendSessionId,
                          }),
                        );
                        logger.debug(
                          `[WebSocket Handler][SSH_SUSPEND_RESUME_REQUEST] 已发送 ssh:connected 给 ${newFrontendSessionId}。`,
                        );
                      }

                      const responseNotification: SshSuspendResumedNotification = {
                        // 确保变量名不冲突且类型正确
                        type: 'SSH_SUSPEND_RESUMED',
                        payload: { suspendSessionId, newFrontendSessionId, success: true },
                      };
                      if (ws.readyState === WebSocket.OPEN) {
                        ws.send(
                          JSON.stringify({ ...responseNotification, sid: newFrontendSessionId }),
                        );
                        // logger.info(`[WebSocket Handler][${type}] 已发送 SSH_SUSPEND_RESUMED 给 ${newFrontendSessionId}。`);
                      } else {
                        // logger.warn(`[WebSocket Handler][${type}] WebSocket 在发送 SSH_SUSPEND_RESUMED 前已关闭 (会话 ${newFrontendSessionId})。`);
                      }

                      // 在成功恢复并通知前端后，调用 handleSshResumeSuccess 启动状态监控
                      handleSshResumeSuccess(newFrontendSessionId);
                    } else {
                      // logger.warn(`[WebSocket Handler][${type}] sshSuspendService.resumeSession 返回 null，无法恢复会话 ${suspendSessionId}。`);
                      throw new Error('服务未能恢复会话，或会话不存在/状态不正确。');
                    }
                  } catch (error: unknown) {
                    // logger.error(`[WebSocket Handler][${type}] 处理恢复会话 ${suspendSessionId} 时发生错误:`, error);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_RESUMED',
                          payload: {
                            suspendSessionId,
                            newFrontendSessionId,
                            success: false,
                            error: getErrorMessage(error) || '恢复会话失败',
                          },
                        }),
                      );
                  }
                  break;
                }
                case 'SSH_SUSPEND_TERMINATE_REQUEST': {
                  const { suspendSessionId } = payload as SshSuspendTerminateRequest['payload'];
                  logger.debug(
                    `[WebSocket Handler] Received SSH_SUSPEND_TERMINATE_REQUEST. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}`,
                  );
                  if (!ws.userId) {
                    logger.error(
                      `[SSH_SUSPEND_TERMINATE_REQUEST] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`,
                    );
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_TERMINATED',
                          payload: { suspendSessionId, success: false, error: '用户认证失败' },
                        }),
                      );
                    break;
                  }
                  try {
                    const success = await sshSuspendService.terminateSuspendedSession(
                      ws.userId,
                      suspendSessionId,
                    );
                    const response: SshSuspendTerminatedResponse = {
                      type: 'SSH_SUSPEND_TERMINATED',
                      payload: { suspendSessionId, success },
                    };
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                  } catch (error: unknown) {
                    logger.error(
                      `[SSH_SUSPEND_TERMINATE_REQUEST] 终止会话 ${suspendSessionId} 失败:`,
                      error,
                    );
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_TERMINATED',
                          payload: {
                            suspendSessionId,
                            success: false,
                            error: getErrorMessage(error) || '终止会话失败',
                          },
                        }),
                      );
                  }
                  break;
                }
                case 'SSH_SUSPEND_REMOVE_ENTRY': {
                  const { suspendSessionId } = payload as SshSuspendRemoveEntryRequest['payload'];
                  logger.debug(
                    `[WebSocket Handler] Received SSH_SUSPEND_REMOVE_ENTRY. UserID: ${ws.userId}, WsSessionID: ${ws.sessionId}, SuspendSessionID: ${suspendSessionId}`,
                  );
                  if (!ws.userId) {
                    logger.error(
                      `[SSH_SUSPEND_REMOVE_ENTRY] 用户 ID 未定义。Payload: ${JSON.stringify(payload)}`,
                    );
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_ENTRY_REMOVED',
                          payload: { suspendSessionId, success: false, error: '用户认证失败' },
                        }),
                      );
                    break;
                  }
                  try {
                    const success = await sshSuspendService.removeDisconnectedSessionEntry(
                      ws.userId,
                      suspendSessionId,
                    );
                    const response: SshSuspendEntryRemovedResponse = {
                      type: 'SSH_SUSPEND_ENTRY_REMOVED',
                      payload: { suspendSessionId, success },
                    };
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                  } catch (error: unknown) {
                    logger.error(
                      `[SSH_SUSPEND_REMOVE_ENTRY] 移除条目 ${suspendSessionId} 失败:`,
                      error,
                    );
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_SUSPEND_ENTRY_REMOVED',
                          payload: {
                            suspendSessionId,
                            success: false,
                            error: getErrorMessage(error) || '移除条目失败',
                          },
                        }),
                      );
                  }
                  break;
                }
                // SSH_SUSPEND_EDIT_NAME case removed, handled by HTTP API now
                case 'SSH_MARK_FOR_SUSPEND': {
                  const markPayload = payload as SshMarkForSuspendRequest['payload'];
                  const requestedSessionToMarkId = markPayload.sessionId;
                  const wsBoundSessionId = typeof ws.sessionId === 'string' ? ws.sessionId : '';
                  // 以后端当前连接绑定的 SID 为准，兼容前端 reconnect 后仍携带旧 SID 的请求。
                  const sessionToMarkId = wsBoundSessionId || requestedSessionToMarkId;
                  const { initialBuffer } = markPayload; // +++ 获取 initialBuffer +++
                  logger.debug(
                    `[WebSocket Handler] Received SSH_MARK_FOR_SUSPEND. UserID: ${ws.userId}, TargetSessionID: ${sessionToMarkId}, RequestedSessionID: ${requestedSessionToMarkId}, InitialBuffer provided: ${!!initialBuffer}`,
                  );

                  if (
                    requestedSessionToMarkId &&
                    wsBoundSessionId &&
                    requestedSessionToMarkId !== wsBoundSessionId
                  ) {
                    logger.warn(
                      `[SSH_MARK_FOR_SUSPEND] 请求会话ID(${requestedSessionToMarkId})与当前WebSocket绑定会话ID(${wsBoundSessionId})不一致，已按当前连接会话处理。`,
                    );
                  }

                  if (!ws.userId) {
                    logger.error(`[SSH_MARK_FOR_SUSPEND] 用户 ID 未定义。`);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                          payload: {
                            sessionId: sessionToMarkId,
                            success: false,
                            error: '用户认证失败',
                          } as SshMarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  if (!sessionToMarkId) {
                    logger.error('[SSH_MARK_FOR_SUSPEND] 缺少有效会话 ID。');
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                          payload: {
                            sessionId: requestedSessionToMarkId || wsBoundSessionId || 'unknown',
                            success: false,
                            error: '缺少有效会话ID',
                          } as SshMarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  const activeSessionState = clientStates.get(sessionToMarkId);
                  if (
                    !activeSessionState ||
                    !activeSessionState.sshClient ||
                    !activeSessionState.sshShellStream
                  ) {
                    logger.error(
                      `[SSH_MARK_FOR_SUSPEND] 找不到活动的SSH会话或其组件: ${sessionToMarkId}`,
                    );
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                          payload: {
                            sessionId: sessionToMarkId,
                            success: false,
                            error: '未找到要标记的活动SSH会话',
                          } as SshMarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  if (activeSessionState.isMarkedForSuspend) {
                    logger.warn(`[SSH_MARK_FOR_SUSPEND] 会话 ${sessionToMarkId} 已被标记。`);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                          payload: {
                            sessionId: sessionToMarkId,
                            success: true,
                            error: '会话已被标记',
                          } as SshMarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  try {
                    // 使用活动会话ID作为日志文件名的一部分
                    const logPathSuffix = sessionToMarkId; // 使用原始 sessionId 作为日志文件名
                    activeSessionState.isMarkedForSuspend = true;
                    activeSessionState.suspendLogPath = logPathSuffix; // 存储日志标识符 (服务内部会拼接完整路径)

                    // 确保日志目录存在 (服务内部通常会做，但这里也可以调用一次)
                    await temporaryLogStorageService.ensureLogDirectoryExists();

                    // +++ 如果有 initialBuffer，先写入它 +++
                    if (initialBuffer) {
                      // 确保 initialBuffer 后有一个换行符，以便后续日志在新行开始
                      const formattedInitialBuffer = initialBuffer.endsWith('\n')
                        ? initialBuffer
                        : `${initialBuffer}\n`;
                      await temporaryLogStorageService.writeToLog(
                        logPathSuffix,
                        formattedInitialBuffer,
                      );
                      logger.debug(
                        `[SSH_MARK_FOR_SUSPEND] 已将初始缓冲区写入日志 (会话: ${sessionToMarkId})。`,
                      );
                    }
                    // --- 移除自动添加的日志标记行 ---
                    // await temporaryLogStorageService.writeToLog(logPathSuffix, `--- Log recording continued for session ${sessionToMarkId} at ${new Date().toISOString()} ---\n`);

                    logger.info(
                      `[SSH_MARK_FOR_SUSPEND] 会话 ${sessionToMarkId} 已成功标记待挂起。日志将记录到与 ${logPathSuffix} 关联的文件。`,
                    );
                    const response: SshMarkedForSuspendAck = {
                      type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                      payload: { sessionId: sessionToMarkId, success: true },
                    };
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                  } catch (error: unknown) {
                    logger.error(`[SSH_MARK_FOR_SUSPEND] 标记会话 ${sessionToMarkId} 失败:`, error);
                    if (activeSessionState) {
                      // 如果状态存在，尝试回滚标记
                      activeSessionState.isMarkedForSuspend = false;
                      activeSessionState.suspendLogPath = undefined;
                    }
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_MARKED_FOR_SUSPEND_ACK',
                          payload: {
                            sessionId: sessionToMarkId,
                            success: false,
                            error: getErrorMessage(error) || '标记会话失败',
                          } as SshMarkedForSuspendAck['payload'],
                        }),
                      );
                  }
                  break;
                }
                case 'SSH_UNMARK_FOR_SUSPEND': {
                  const unmarkPayload = payload as SshUnmarkForSuspendRequest['payload'];
                  const requestedSessionToUnmarkId = unmarkPayload.sessionId;
                  const wsBoundSessionId = typeof ws.sessionId === 'string' ? ws.sessionId : '';
                  // 与标记逻辑一致：优先使用当前连接 SID，避免旧 SID 导致"会话不存在"。
                  const sessionToUnmarkId = wsBoundSessionId || requestedSessionToUnmarkId;
                  logger.debug(
                    `[WebSocket Handler] Received SSH_UNMARK_FOR_SUSPEND. UserID: ${ws.userId}, TargetSessionID: ${sessionToUnmarkId}, RequestedSessionID: ${requestedSessionToUnmarkId}`,
                  );
                  const ackPayloadBase = { sessionId: sessionToUnmarkId };

                  if (
                    requestedSessionToUnmarkId &&
                    wsBoundSessionId &&
                    requestedSessionToUnmarkId !== wsBoundSessionId
                  ) {
                    logger.warn(
                      `[SSH_UNMARK_FOR_SUSPEND] 请求会话ID(${requestedSessionToUnmarkId})与当前WebSocket绑定会话ID(${wsBoundSessionId})不一致，已按当前连接会话处理。`,
                    );
                  }

                  if (!ws.userId) {
                    logger.error(`[SSH_UNMARK_FOR_SUSPEND] 用户 ID 未定义。`);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                          payload: {
                            ...ackPayloadBase,
                            success: false,
                            error: '用户认证失败',
                          } as SshUnmarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  if (!sessionToUnmarkId) {
                    logger.error('[SSH_UNMARK_FOR_SUSPEND] 缺少有效会话 ID。');
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                          payload: {
                            sessionId: requestedSessionToUnmarkId || wsBoundSessionId || 'unknown',
                            success: false,
                            error: '缺少有效会话ID',
                          } as SshUnmarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  const activeSessionState = clientStates.get(sessionToUnmarkId);
                  if (!activeSessionState) {
                    logger.warn(`[SSH_UNMARK_FOR_SUSPEND] 未找到会话: ${sessionToUnmarkId}`);
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                          payload: {
                            ...ackPayloadBase,
                            success: false,
                            error: '未找到要取消标记的会话',
                          } as SshUnmarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  if (!activeSessionState.isMarkedForSuspend) {
                    logger.warn(
                      `[SSH_UNMARK_FOR_SUSPEND] 会话 ${sessionToUnmarkId} 并未被标记为待挂起。`,
                    );
                    // 即使未标记，也回复成功，因为最终状态是"未标记"
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                          payload: {
                            ...ackPayloadBase,
                            success: true,
                            error: '会话本就未标记',
                          } as SshUnmarkedForSuspendAck['payload'],
                        }),
                      );
                    break;
                  }

                  try {
                    activeSessionState.isMarkedForSuspend = false;
                    const logPathToDelete = activeSessionState.suspendLogPath;
                    activeSessionState.suspendLogPath = undefined; // 清除日志路径

                    if (logPathToDelete) {
                      await temporaryLogStorageService.deleteLog(logPathToDelete);
                      logger.debug(
                        `[SSH_UNMARK_FOR_SUSPEND] 已删除会话 ${sessionToUnmarkId} 的临时挂起日志: ${logPathToDelete}`,
                      );
                    }

                    logger.info(
                      `[SSH_UNMARK_FOR_SUSPEND] 会话 ${sessionToUnmarkId} 已成功取消标记。`,
                    );
                    const response: SshUnmarkedForSuspendAck = {
                      type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                      payload: { ...ackPayloadBase, success: true },
                    };
                    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(response));
                  } catch (error: unknown) {
                    logger.error(
                      `[SSH_UNMARK_FOR_SUSPEND] 取消标记会话 ${sessionToUnmarkId} 失败:`,
                      error,
                    );
                    // 尝试回滚状态（尽管可能意义不大，因为错误可能在删除日志时发生）
                    if (activeSessionState) {
                      activeSessionState.isMarkedForSuspend = true; // 保持标记状态
                      // activeSessionState.suspendLogPath = logPathToDelete; // 如果需要，可以恢复路径，但删除失败更可能是问题
                    }
                    if (ws.readyState === WebSocket.OPEN)
                      ws.send(
                        JSON.stringify({
                          type: 'SSH_UNMARKED_FOR_SUSPEND_ACK',
                          payload: {
                            ...ackPayloadBase,
                            success: false,
                            error: getErrorMessage(error) || '取消标记会话失败',
                          } as SshUnmarkedForSuspendAck['payload'],
                        }),
                      );
                  }
                  break;
                }
                default:
                  logger.warn(
                    `WebSocket：收到来自 ${ws.username} (会话: ${effectiveSessionId}) 的未知消息类型: ${type}`,
                  );
                  if (ws.readyState === WebSocket.OPEN)
                    ws.send(
                      JSON.stringify({ type: 'error', payload: `不支持的消息类型: ${type}` }),
                    );
              }
            } catch (error: unknown) {
              logger.error(
                `WebSocket: 处理来自 ${ws.username} (会话: ${effectiveSessionId}) 的消息 (${type}) 时发生顶层错误:`,
                error,
              );
              if (ws.readyState === WebSocket.OPEN)
                ws.send(
                  JSON.stringify({
                    type: 'error',
                    payload: `处理消息时发生内部错误: ${getErrorMessage(error)}`,
                  }),
                );
            }
          }, // end withLogContext async
        );
      });

      /**
       * 共享断开连接清理逻辑
       * close 和 error 事件处理器使用相同的清理流程
       */
      const handleDisconnect = (reason: string, error?: Error): void => {
        if (error) {
          logger.error(
            `WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId || '未建立'}) 发生错误:`,
            error,
          );
        }

        // 注销 userId 到 WebSocket 的映射
        if (ws.userId) {
          unregisterUserSocket(ws.userId, ws);
        }

        // 清理心跳状态
        cleanupHeartbeat(ws);

        // 清理速率限制状态（使用与检查相同的 key 生成逻辑，避免内存泄漏）
        cleanupRateLimit(getRateLimitKey(ws));
        // 同时清理可能的 fallback key（连接建立初期 sessionId 尚未分配时使用的 key）
        if (ws.sessionId && ws.userId) {
          cleanupRateLimit(`ws_${ws.userId}`);
        }

        // 清理多路复用传输（内部会销毁所有通道的批处理器）
        if (multiplexTransport) {
          unregisterTransport(ws);
          multiplexTransport.cleanup();
        }

        // 多路复用模式：遍历所有注册通道，逐个清理 SSH/SFTP 资源
        const channels = transportChannels.get(ws);
        if (channels && channels.size > 0) {
          for (const channelId of channels) {
            destroyBatcher(channelId);
            cleanupClientConnection(channelId).catch((cleanupError: unknown) => {
              logger.debug(
                `[WebSocket] 通道 ${channelId} ${reason}后清理失败:`,
                cleanupError instanceof Error ? cleanupError.message : cleanupError,
              );
            });
          }
          transportChannels.delete(ws);
        } else if (ws.sessionId) {
          // 非多路复用模式：清理单个会话
          destroyBatcher(ws.sessionId);
          cleanupClientConnection(ws.sessionId).catch((cleanupError: unknown) => {
            logger.debug(
              `[WebSocket] 连接${reason}后清理失败:`,
              cleanupError instanceof Error ? cleanupError.message : cleanupError,
            );
          });
        }
      };

      ws.on('close', (code, reason) => {
        logger.debug(
          `WebSocket：客户端 ${ws.username} (会话: ${ws.sessionId || '未建立'}) 已断开连接。代码: ${code}, 原因: ${reason.toString()}`,
        );
        handleDisconnect('关闭');
      });

      ws.on('error', (error) => {
        handleDisconnect('错误', error);
      });
    }
  });

  // 监听 SshSuspendService 发出的会话自动终止事件
  sshSuspendService.on(
    'sessionAutoTerminated',
    (eventPayload: { userId: number; suspendSessionId: string; reason: string }) => {
      const { userId, suspendSessionId, reason } = eventPayload;
      logger.debug(
        `[WebSocket 通知] 准备发送 SSH_SUSPEND_AUTO_TERMINATED 给用户 ${userId} 的会话 ${suspendSessionId}`,
      );

      wss.clients.forEach((client) => {
        const wsClient = client as AuthenticatedWebSocket; // 类型断言
        if (wsClient.userId === userId && wsClient.readyState === WebSocket.OPEN) {
          const notification: SshSuspendAutoTerminatedNotification = {
            type: 'SSH_SUSPEND_AUTO_TERMINATED',
            payload: {
              suspendSessionId,
              reason,
            },
          };
          wsClient.send(JSON.stringify(notification));
          logger.debug(
            `[WebSocket 通知] 已发送 SSH_SUSPEND_AUTO_TERMINATED 给用户 ${userId} 的一个 WebSocket 连接 (会话 ${suspendSessionId})。`,
          );
        }
      });
    },
  );

  logger.info(
    'WebSocket connection handler initialized, including SshSuspendService event listener.',
  );
}
