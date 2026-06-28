import { isAxiosError } from 'axios';
import type { Composer } from 'vue-i18n';
import { sessions, suspendedSshSessions, isLoadingSuspendedSessions } from '../state';
import type {
  MessagePayload,
  SshMarkForSuspendReqMessage,
  SshUnmarkForSuspendReqMessage,
  SshSuspendResumeReqMessage,
  SshMarkedForSuspendAckPayload,
  SshUnmarkedForSuspendAckPayload,
  SshSuspendListResponsePayload,
  SshSuspendResumedPayload,
  SshOutputCachedChunkPayload,
  SshSuspendTerminatedPayload,
  SshSuspendEntryRemovedPayload,
  SshSuspendAutoTerminatedPayload,
} from '../../../types/websocket.types';
import type { WsManagerInstance, SessionState } from '../types';
import { useConnectionsStore } from '../../connections.store';
import { useUiNotificationsStore } from '../../uiNotifications.store';
import type { SuspendedSshSession } from '../../../types/ssh-suspend.types';
import i18n from '../../../i18n';
import apiClient from '../../../utils/apiClient';
import { extractErrorMessage } from '../../../utils/errorExtractor';
import { log } from '@/utils/log';

const { t } = i18n.global as unknown as Composer;

const loadSessionActions = () => import('./sessionActions');

/**
 * 请求启动 SSH 会话挂起
 * @param sessionId 要挂起的活动会话 ID
 */
export const requestStartSshSuspend = (sessionId: string): void => {
  const session = sessions.value.get(sessionId);
  if (session && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      log.warn(
        `[${t('term.sshSuspend')}] WebSocket 未连接，无法请求标记挂起 (会话 ID: ${sessionId})。`,
      );
      useUiNotificationsStore().addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.wsNotConnectedError'),
      });
      return;
    }

    let initialBuffer = '';
    if (
      session.terminalManager &&
      session.terminalManager.terminalInstance &&
      session.terminalManager.terminalInstance.value
    ) {
      const term = session.terminalManager.terminalInstance.value;
      const buffer = term.buffer.active;

      // 与后端 Zod 校验保持一致：initialBuffer 最大 1MB
      // 预留 1KB 余量，避免边界情况
      const MAX_BUFFER_BYTES = 1048576 - 1024;

      let lastNonEmptyLineIndex = -1;
      // 从下往上找到最后一个非空行
      for (let i = buffer.length - 1; i >= 0; i--) {
        const line = buffer.getLine(i);
        // translateToString(true) 会移除行尾空白，再 trim() 判断是否整行都是空白
        if (line && line.translateToString(true).trim() !== '') {
          lastNonEmptyLineIndex = i;
          break;
        }
      }

      if (lastNonEmptyLineIndex !== -1) {
        // 从末尾（最新内容）开始收集，累计大小接近限制时停止
        // 保留最新内容，丢弃最早的终端输出
        const lines: string[] = [];
        let totalBytes = 0;
        let truncatedFromHead = false;

        for (let i = lastNonEmptyLineIndex; i >= 0; i--) {
          const lineText = buffer.getLine(i)?.translateToString(true) || '';
          // 每行大小 = 行内容 UTF-8 字节长度 + 换行符 1 字节
          const lineBytes = new TextEncoder().encode(lineText).length + 1;

          if (totalBytes + lineBytes > MAX_BUFFER_BYTES && lines.length > 0) {
            // 超出限制，停止收集更早的行
            truncatedFromHead = true;
            break;
          }

          lines.push(lineText);
          totalBytes += lineBytes;
        }

        // lines 是从末尾往前收集的，需要反转为正确顺序
        lines.reverse();
        initialBuffer = lines.join('\n');

        if (truncatedFromHead) {
          log.warn(
            `[${t('term.sshSuspend')}] 终端缓冲区超过 1MB 限制，已截断最早的输出内容 (会话: ${sessionId})。`,
          );
        }
      }
    } else {
      log.warn(`[${t('term.sshSuspend')}] 未能获取会话 ${sessionId} 的终端实例以提取初始缓冲区。`);
    }

    const message: SshMarkForSuspendReqMessage = {
      type: 'SSH_MARK_FOR_SUSPEND',
      payload: { sessionId, initialBuffer: initialBuffer || undefined }, // +++ 将 initialBuffer 添加到 payload +++
    };
    session.wsManager.sendMessage(message);
    log.info(
      `[${t('term.sshSuspend')}] 已发送 SSH_MARK_FOR_SUSPEND 请求 (会话 ID: ${sessionId}, 包含初始缓冲区: ${!!initialBuffer})`,
    );
    // 这里不提前提示"已标记成功"，统一由 ACK 结果驱动，避免出现"先成功后失败"的误导提示。
  } else {
    log.warn(
      `[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法请求标记挂起。`,
    );
    useUiNotificationsStore().addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.sessionNotFoundError'),
    });
  }
};

/**
 * 请求取消标记一个会话为待挂起
 * @param sessionId 要取消标记的活动会话 ID
 */
export const requestUnmarkSshSuspend = (sessionId: string): void => {
  const session = sessions.value.get(sessionId);
  if (session && session.wsManager) {
    if (!session.wsManager.isConnected.value) {
      log.warn(
        `[${t('term.sshSuspend')}] WebSocket 未连接，无法请求取消标记挂起 (会话 ID: ${sessionId})。`,
      );
      useUiNotificationsStore().addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.wsNotConnectedError'),
      });
      return;
    }
    if (!session.isMarkedForSuspend) {
      log.warn(`[${t('term.sshSuspend')}] 会话 ${sessionId} 并未被标记为待挂起，无需取消。`);
      // 可以选择不发送请求或发送一个让后端确认的请求
      // 为保持简单，如果前端状态已经是未标记，则不执行操作或仅给用户提示
      useUiNotificationsStore().addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.notMarkedWarning'),
      });
      return;
    }

    const message: SshUnmarkForSuspendReqMessage = {
      type: 'SSH_UNMARK_FOR_SUSPEND',
      payload: { sessionId },
    };
    session.wsManager.sendMessage(message);
    log.info(
      `[${t('term.sshSuspend')}] 已发送 SSH_UNMARK_FOR_SUSPEND 请求 (会话 ID: ${sessionId})`,
    );
  } else {
    log.warn(
      `[${t('term.sshSuspend')}] 未找到会话或 WebSocket 管理器 (会话 ID: ${sessionId})，无法请求取消标记挂起。`,
    );
    useUiNotificationsStore().addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.sessionNotFoundError'),
    });
  }
};

/**
 * 获取挂起的 SSH 会话列表 (通过 HTTP API)
 */
export const fetchSuspendedSshSessions = async (options?: {
  showLoadingIndicator?: boolean;
  notifyOnError?: boolean;
}): Promise<{ ok: boolean; status?: number }> => {
  const shouldShowLoading = options?.showLoadingIndicator ?? true;
  const shouldNotifyOnError = options?.notifyOnError ?? true;

  if (shouldShowLoading) {
    isLoadingSuspendedSessions.value = true;
  }
  try {
    // 假设后端 API 端点为 /api/ssh/suspended-sessions
    // 并且它返回 SuspendedSshSession[] 类型的数据
    const response = await apiClient.get<SuspendedSshSession[]>('ssh-suspend/suspended-sessions');
    suspendedSshSessions.value = response.data;
    log.info(`[${t('term.sshSuspend')}] 已通过 HTTP 获取挂起列表，数量: ${response.data.length}`);
    return { ok: true, status: 200 };
  } catch (error: unknown) {
    log.error(`[${t('term.sshSuspend')}] 通过 HTTP 获取挂起列表失败:`, error);
    const status = isAxiosError(error) ? error.response?.status : undefined;
    if (shouldNotifyOnError) {
      const uiNotificationsStore = useUiNotificationsStore();
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.fetchListError', { error: String(error) }),
      });
    }
    // 即使失败，也可能需要清空旧数据或保留旧数据，具体取决于产品需求
    // suspendedSshSessions.value = []; // 例如，失败时清空
    return { ok: false, status };
  } finally {
    if (shouldShowLoading) {
      isLoadingSuspendedSessions.value = false;
    }
  }
};

/**
 * 请求恢复指定的挂起 SSH 会话
 * @param suspendSessionId 要恢复的挂起会话的 ID
 */
export const resumeSshSession = async (suspendSessionId: string): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  const connectionsStore = useConnectionsStore();
  // const { t } = useI18n(); // t 已经在模块顶部定义

  const sessionToResumeInfo = suspendedSshSessions.value.find(
    (s) => s.suspendSessionId === suspendSessionId,
  );
  if (!sessionToResumeInfo) {
    log.error(`[${t('term.sshSuspend')}] 恢复操作失败：在挂起列表中未找到会话 ${suspendSessionId}`);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.resumeErrorInfoNotFound', {
        id: suspendSessionId.slice(0, 8),
      }),
    });
    return;
  }

  const originalConnectionId = parseInt(sessionToResumeInfo.connectionId, 10);
  if (Number.isNaN(originalConnectionId)) {
    log.error(
      `[${t('term.sshSuspend')}] 恢复操作失败：无效的原始连接 ID ${sessionToResumeInfo.connectionId}`,
    );
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.resumeErrorConnectionConfigNotFound', {
        id: sessionToResumeInfo.connectionId,
      }),
    });
    return;
  }

  const newFrontendSessionId = crypto.randomUUID(); // 为恢复的会话生成新的前端 ID

  try {
    // +++ 先从 connectionsStore 获取完整的 ConnectionInfo +++
    const connectionInfo = connectionsStore.connections.find((c) => c.id === originalConnectionId);
    if (!connectionInfo) {
      log.error(
        `[${t('term.sshSuspend')}] 恢复操作失败：在 Connection Store 中未找到原始连接配置 (ID: ${originalConnectionId})。`,
      );
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorConnectionConfigNotFound', {
          id: String(originalConnectionId),
        }),
      });
      return;
    }
    log.info(
      `[${t('term.sshSuspend')}] 已找到原始连接配置 (ID: ${originalConnectionId})，准备使用它恢复会话 ${suspendSessionId}。将创建新前端会话 ${newFrontendSessionId} 并连接 WebSocket。`,
    );

    // 1. 调用 openNewSession 创建前端会话状态、WebSocket 连接等，传入完整的 connectionInfo
    const { openNewSession } = await loadSessionActions();
    openNewSession(
      connectionInfo, // +++ 传入完整的 ConnectionInfo 对象 +++
      { connectionsStore, t }, // 传递依赖
      newFrontendSessionId, // 将 newFrontendSessionId 作为 existingSessionId 传递
    );

    // 2. 获取新创建会话的 wsManager
    const newSessionState = sessions.value.get(newFrontendSessionId);
    if (!newSessionState || !newSessionState.wsManager) {
      log.error(
        `[${t('term.sshSuspend')}] 调用 openNewSession 后未能获取会话 ${newFrontendSessionId} 或其 wsManager。`,
      );
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', {
          error: '无法初始化新会话界面组件',
        }),
      });
      return;
    }
    const { wsManager } = newSessionState;

    // 3. 等待 WebSocket 连接成功
    const MAX_WAIT_ITERATIONS = 25; // 25 * 200ms = 5 seconds
    let iterations = 0;
    while (!wsManager.isConnected.value && iterations < MAX_WAIT_ITERATIONS) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      iterations++;
    }

    if (!wsManager.isConnected.value) {
      log.error(
        `[${t('term.sshSuspend')}] 新创建的会话 ${newFrontendSessionId} 的 WebSocket 未能连接。无法发送恢复请求。`,
      );
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', {
          error: '无法连接到服务器以恢复会话',
        }),
      });
      if (sessions.value.has(newFrontendSessionId)) {
        const { closeSession } = await loadSessionActions();
        closeSession(newFrontendSessionId); // 清理未成功连接的会话
      }
      return;
    }

    // 4. 发送恢复请求
    log.info(
      `[${t('term.sshSuspend')}] 会话 ${newFrontendSessionId} 的 WebSocket 已连接，准备发送恢复请求。`,
    );
    const message: SshSuspendResumeReqMessage = {
      type: 'SSH_SUSPEND_RESUME_REQUEST',
      payload: { suspendSessionId, newFrontendSessionId },
    };
    // log.info(`[${t('term.sshSuspend')}] resumeSshSession: 准备通过 wsManager (会话 ${newFrontendSessionId}) 发送消息: ${JSON.stringify(message)}`);
    wsManager.sendMessage(message);
    // log.info(`[${t('term.sshSuspend')}] resumeSshSession: 已调用 wsManager.sendMessage 发送 SSH_SUSPEND_RESUME_REQ (挂起 ID: ${suspendSessionId}, 新前端ID: ${newFrontendSessionId})`);

    // 后续流程由 handleSshSuspendResumed 处理
    // 它会使用 newFrontendSessionId，并将 isResuming 标记设置到这个会话上。
    // 成功后，它内部应该会调用 fetchSuspendedSshSessions() 来更新列表。
  } catch (error: unknown) {
    log.error(`[${t('term.sshSuspend')}] 恢复会话 ${suspendSessionId} 过程中发生顶层错误:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.resumeErrorGeneric', { error: String(error) }),
    });
    // 如果 newFrontendSessionId 对应的会话已创建但恢复失败，也需要清理
    if (sessions.value.has(newFrontendSessionId)) {
      const { closeSession } = await loadSessionActions();
      closeSession(newFrontendSessionId);
    }
  }
};

/**
 * 请求终止并移除一个活跃的挂起 SSH 会话
 * @param suspendSessionId 要终止并移除的挂起会话 ID
 */
export const terminateAndRemoveSshSession = async (suspendSessionId: string): Promise<void> => {
  log.info(
    `[${t('term.sshSuspend')}] 请求通过 HTTP API 终止并移除挂起会话 (ID: ${suspendSessionId})`,
  );
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 返回成功时状态码为 200/204，失败时返回错误信息
    await apiClient.delete(`ssh-suspend/terminate/${suspendSessionId}`);
    log.info(`[${t('term.sshSuspend')}] HTTP API 终止并移除会话 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendTerminated 的逻辑
    const index = suspendedSshSessions.value.findIndex(
      (s) => s.suspendSessionId === suspendSessionId,
    );
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', {
          name: removedSession.customSuspendName || removedSession.connectionName,
        }),
      });
    }
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error, t('term.unknownError'));
    log.error(
      `[${t('term.sshSuspend')}] 通过 HTTP API 终止并移除会话 ${suspendSessionId} 失败:`,
      error,
    );
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', {
        error: errorMessage,
      }),
    });
  }
};

/**
 * 请求移除一个已断开的挂起 SSH 会话条目
 * @param suspendSessionId 要移除的挂起会话条目 ID
 */
export const removeSshSessionEntry = async (suspendSessionId: string): Promise<void> => {
  log.info(
    `[${t('term.sshSuspend')}] 请求通过 HTTP API 移除已断开的挂起条目 (ID: ${suspendSessionId})`,
  );
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    await apiClient.delete(`ssh-suspend/entry/${suspendSessionId}`);
    log.info(`[${t('term.sshSuspend')}] HTTP API 移除已断开条目 ${suspendSessionId} 成功。`);

    // 复用或直接实现 handleSshSuspendEntryRemoved 的逻辑
    const index = suspendedSshSessions.value.findIndex(
      (s) => s.suspendSessionId === suspendSessionId,
    );
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', {
          name: removedSession.customSuspendName || removedSession.connectionName,
        }),
      });
    }
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error, t('term.unknownError'));
    log.error(
      `[${t('term.sshSuspend')}] 通过 HTTP API 移除已断开条目 ${suspendSessionId} 失败:`,
      error,
    );
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', {
        error: errorMessage,
      }),
    });
  }
};

/**
 * 请求编辑挂起 SSH 会话的自定义名称 (通过 HTTP API)
 * @param suspendSessionId 要编辑的挂起会话 ID
 * @param newCustomName 新的自定义名称
 */
export const editSshSessionName = async (
  suspendSessionId: string,
  newCustomName: string,
): Promise<void> => {
  log.info(
    `[${t('term.sshSuspend')}] 请求通过 HTTP API 编辑挂起会话名称 (ID: ${suspendSessionId}, 新名称: "${newCustomName}")`,
  );
  const uiNotificationsStore = useUiNotificationsStore();
  try {
    // 假设后端 API 端点为 /api/ssh-suspend/name/:suspendSessionId
    // 并且它接受一个包含 { customName: string } 的 PUT 请求体
    // 并返回包含 { message: string, customName: string } 的成功响应
    const response = await apiClient.put<{ message: string; customName: string }>(
      `ssh-suspend/name/${suspendSessionId}`,
      { customName: newCustomName },
    );

    log.info(
      `[${t('term.sshSuspend')}] HTTP API 编辑名称 ${suspendSessionId} 成功:`,
      response.data,
    );

    // 更新前端状态
    const session = suspendedSshSessions.value.find((s) => s.suspendSessionId === suspendSessionId);
    if (session) {
      session.customSuspendName = response.data.customName; // 使用后端返回的名称确保一致性
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.nameEditedSuccess', {
          name: response.data.customName,
        }),
      });
    } else {
      // 如果会话在前端列表中找不到了（理论上不应该发生，因为是先找到再编辑的）
      // 也可以选择重新获取列表
      // 加 catch 兜底，避免 fire-and-forget 产生 unhandled rejection
      fetchSuspendedSshSessions().catch((error: unknown) => {
        log.error(`[${t('term.sshSuspend')}] 编辑名称后回退获取挂起列表失败:`, error);
      });
    }
  } catch (error: unknown) {
    const errorMessage = extractErrorMessage(error, t('term.unknownError'));
    log.error(`[${t('term.sshSuspend')}] 通过 HTTP API 编辑名称 ${suspendSessionId} 失败:`, error);
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.nameEditedError', {
        error: errorMessage,
      }),
    });
  }
};

/**
 * 请求导出指定挂起 SSH 会话的日志
 * @param suspendSessionId 要导出日志的挂起会话 ID
 */
export const exportSshSessionLog = async (suspendSessionId: string): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 请求导出挂起会话日志 (ID: ${suspendSessionId})`);

  try {
    // API 端点为 /api/v1/ssh-suspend/log/:suspendSessionId
    // apiClient.get会自动处理Blob响应类型，并尝试触发下载
    // 我们需要获取建议的文件名，后端会在 Content-Disposition 头中提供
    const response = await apiClient.get<Blob>(`ssh-suspend/log/${suspendSessionId}`, {
      responseType: 'blob', // 重要：期望响应为 Blob
      // 我们可以传递一个 onDownloadProgress 回调（如果 apiClient 支持的话）
    });

    // 从 Content-Disposition 获取文件名
    const contentDisposition = response.headers['content-disposition'];
    let filename = `ssh_log_${suspendSessionId}.log`; // 默认文件名
    if (contentDisposition) {
      const filenameMatch = contentDisposition.match(/filename="?(.+)"?/i);
      if (filenameMatch && filenameMatch.length > 1) {
        filename = filenameMatch[1];
      }
    }

    // 创建一个下载链接并点击它
    const url = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', filename); // 设置下载文件名
    document.body.appendChild(link);
    link.click();

    // 清理
    link.parentNode?.removeChild(link);
    window.URL.revokeObjectURL(url);

    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.logExportSuccess', { name: filename }),
    });
    log.info(
      `[${t('term.sshSuspend')}] 挂起会话日志 ${filename} (ID: ${suspendSessionId}) 已开始下载。`,
    );
  } catch (error: unknown) {
    log.error(`[${t('term.sshSuspend')}] 导出挂起会话日志 ${suspendSessionId} 失败:`, error);
    let errorMessage = t('term.unknownError');
    if (isAxiosError(error) && error.response?.data) {
      // 如果响应是 Blob 但我们期望 JSON 错误信息，需要特殊处理
      // 假设错误时后端会返回 JSON
      const responseData = error.response.data;
      const responseContentType = error.response.headers?.['content-type'] as string | undefined;
      if (responseData instanceof Blob && responseContentType?.includes('application/json')) {
        try {
          const errorJson = JSON.parse(await responseData.text()) as { message?: string };
          errorMessage = errorJson.message || errorMessage;
        } catch {
          // Blob 不是有效的 JSON，使用通用错误信息
          log.debug('[SSH挂起] 错误响应 Blob 解析失败:', error);
        }
      } else if (typeof responseData === 'object' && responseData !== null) {
        errorMessage = extractErrorMessage(error, errorMessage);
      } else {
        errorMessage = extractErrorMessage(error, errorMessage);
      }
    } else {
      errorMessage = extractErrorMessage(error, String(error));
    }
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.logExportError', { error: errorMessage }),
    });
  }
};

// --- S2C Message Handlers ---

// 旧的 handleSshSuspendStarted 不再需要，因为流程已改变
// const handleSshSuspendStarted = (payload: SshSuspendStartedPayload): void => { ... };

const handleSshMarkedForSuspendAck = (payload: SshMarkedForSuspendAckPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 接到 SSH_MARKED_FOR_SUSPEND_ACK:`, payload);
  if (payload.success) {
    // 仅在后端确认后再提示成功，保证用户看到的是最终状态。
    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.markedForSuspendSuccess', {
        id: payload.sessionId.slice(0, 8),
      }),
    });
    const session = sessions.value.get(payload.sessionId);
    if (session) {
      session.isMarkedForSuspend = true; // 假设 SessionState 有此字段
      sessions.value = new Map(sessions.value); // 强制更新 Map
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.markForSuspendError', {
        error: payload.error || t('term.unknownError'),
      }),
    });
    log.error(`[${t('term.sshSuspend')}] 标记会话 ${payload.sessionId} 失败: ${payload.error}`);
    const session = sessions.value.get(payload.sessionId);
    if (session) {
      session.isMarkedForSuspend = false; // 确保标记被清除
      sessions.value = new Map(sessions.value); // 强制更新 Map
    }
  }
};

const handleSshUnmarkedForSuspendAck = (payload: SshUnmarkedForSuspendAckPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 接到 SSH_UNMARKED_FOR_SUSPEND_ACK:`, payload);
  const session = sessions.value.get(payload.sessionId);

  if (payload.success) {
    if (session) {
      session.isMarkedForSuspend = false;
      sessions.value = new Map(sessions.value); // 强制更新 Map
    }
    uiNotificationsStore.addNotification({
      type: 'success',
      message: t('sshSuspend.notifications.unmarkedSuccess', { id: payload.sessionId.slice(0, 8) }),
    });
  } else {
    // 即便后端失败，如果前端之前是标记状态，也最好保持一致或提示用户检查
    // 但通常后端失败意味着前端状态可能与后端不一致，提示错误让用户知晓
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.unmarkError', {
        error: payload.error || t('term.unknownError'),
      }),
    });
    log.error(`[${t('term.sshSuspend')}] 取消标记会话 ${payload.sessionId} 失败: ${payload.error}`);
    // 此处不自动回滚前端的 isMarkedForSuspend 状态，因为后端是权威源。
    // 如果后端说操作失败，那么会话可能仍然被后端认为是标记的（尽管这不应该发生，因为后端会先清除标记）。
  }
};

const handleSshSuspendListResponse = (payload: SshSuspendListResponsePayload): void => {
  log.info(
    `[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_LIST_RESPONSE，数量: ${payload.suspendSessions.length}`,
  );
  suspendedSshSessions.value = payload.suspendSessions;
  isLoadingSuspendedSessions.value = false;
};

const handleSshSuspendResumed = async (payload: SshSuspendResumedPayload): Promise<void> => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_RESUMED:`, payload);

  if (payload.success) {
    const suspendedSession = suspendedSshSessions.value.find(
      (s) => s.suspendSessionId === payload.suspendSessionId,
    );
    // suspendedSession 主要用于显示通知的友好名称。如果找不到，恢复流程仍可继续，但通知可能不那么具体。
    if (!suspendedSession) {
      log.warn(
        `[${t('term.sshSuspend')}] 处理 SSH_SUSPEND_RESUMED 时：在挂起列表中未找到会话 ${payload.suspendSessionId} 的详细信息。通知消息可能不完整。`,
      );
    }

    try {
      // 会话应该已由 resumeSshSession action 通过调用 openNewSession 创建。
      // 它包含了所有必要的管理器和 WebSocket 连接。
      const sessionToUpdate = sessions.value.get(payload.newFrontendSessionId) as
        | SessionState
        | undefined;

      if (!sessionToUpdate) {
        log.error(
          `[${t('term.sshSuspend')}] 处理 SSH_SUSPEND_RESUMED 失败：未找到 ID 为 ${payload.newFrontendSessionId} 的预创建会话。`,
        );
        uiNotificationsStore.addNotification({
          type: 'error',
          message: t('sshSuspend.notifications.resumeErrorGeneric', {
            error: '无法找到已初始化的恢复会话界面组件。',
          }),
        });
        // 如果会话未找到，可能意味着 resumeSshSession 中的 openNewSession 失败或被意外清理
        return;
      }

      // 确保 wsManager 存在，理论上它应该由 openNewSession 创建
      if (!sessionToUpdate.wsManager) {
        log.error(
          `[${t('term.sshSuspend')}] 会话 ${payload.newFrontendSessionId} 存在但缺少 wsManager。`,
        );
        uiNotificationsStore.addNotification({
          type: 'error',
          message: '恢复失败：会话状态不完整。',
        });
        return;
      }

      sessionToUpdate.isResuming = true; // 标记会话为正在恢复
      // (可选) 如果需要在 SessionState 中存储原始挂起ID:
      // sessionToUpdate.originalSuspendId = payload.suspendSessionId;

      log.info(`[${t('term.sshSuspend')}] 会话 ${payload.newFrontendSessionId} 已标记为正在恢复。`);
      const { activateSession } = await loadSessionActions();
      activateSession(payload.newFrontendSessionId); // 激活标签页

      let notificationName = t('sshSuspend.notifications.defaultSessionName'); // 使用 i18n 获取默认名
      if (suspendedSession) {
        notificationName =
          suspendedSession.customSuspendName || suspendedSession.connectionName || notificationName;
      }
      uiNotificationsStore.addNotification({
        type: 'success',
        message: t('sshSuspend.notifications.resumeSuccess', { name: notificationName }),
      });
      // 后端会通过与此 sessionToUpdate.wsManager 关联的 WebSocket 连接发送 SSH_OUTPUT_CACHED_CHUNK
    } catch (error: unknown) {
      log.error(`[${t('term.sshSuspend')}] 处理会话恢复通知时出错:`, error);
      uiNotificationsStore.addNotification({
        type: 'error',
        message: t('sshSuspend.notifications.resumeErrorGeneric', { error: String(error) }),
      });
    }
    // 成功恢复后，立即从前端挂起列表中移除
    const resumedSessionIndex = suspendedSshSessions.value.findIndex(
      (s) => s.suspendSessionId === payload.suspendSessionId,
    );
    if (resumedSessionIndex !== -1) {
      suspendedSshSessions.value.splice(resumedSessionIndex, 1);
      log.info(
        `[${t('term.sshSuspend')}] Successfully resumed and removed session ${payload.suspendSessionId} from the frontend list.`,
      );
    }
    // 可选：fetchSuspendedSshSessions(); // 如果仍然需要与后端同步最新列表，可以保留，但即时性由上面的 splice 保证
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.resumeErrorBackend', {
        error: payload.error || t('term.unknownError'),
      }),
    });
    log.error(
      `[${t('term.sshSuspend')}] 后端报告恢复会话失败 (挂起 ID: ${payload.suspendSessionId}): ${payload.error}`,
    );
    // 如果后端报告恢复失败，可能需要关闭由 resumeSshSession 创建的前端会话
    if (sessions.value.has(payload.newFrontendSessionId)) {
      log.info(
        `[${t('term.sshSuspend')}] 因后端恢复失败，正在关闭前端会话 ${payload.newFrontendSessionId}`,
      );
      const { closeSession } = await loadSessionActions();
      closeSession(payload.newFrontendSessionId);
    }
  }
};

const handleSshOutputCachedChunk = (payload: SshOutputCachedChunkPayload): void => {
  const session = sessions.value.get(payload.frontendSessionId) as SessionState | undefined;
  if (session && session.terminalManager) {
    if (session.terminalManager.terminalInstance.value) {
      // 终端实例已就绪，直接写入
      log.info(
        '[SSH Suspend Frontend] Received cached chunk data (writing to terminal):',
        payload.data,
      );
      session.terminalManager.terminalInstance.value.write(payload.data);
    } else {
      // 终端实例尚未就绪，暂存输出
      if (!session.pendingOutput) {
        session.pendingOutput = [];
      }
      log.info('[SSH Suspend Frontend] Received cached chunk data (buffering):', payload.data);
      session.pendingOutput.push(payload.data);
      // log.info(`[${t('term.sshSuspend')}] (会话: ${payload.frontendSessionId}) 终端实例未就绪，已暂存数据块 (长度: ${payload.data.length})。当前暂存块数: ${session.pendingOutput.length}`);
    }

    // isLastChunk 逻辑应该在数据被处理（写入或暂存）后执行
    if (payload.isLastChunk) {
      log.info(
        `[${t('term.sshSuspend')}] (会话: ${payload.frontendSessionId}) 已接收所有缓存输出的最后一个数据块标记。`,
      );
      if (session.isResuming === true) {
        // 如果终端实例还未就绪，isResuming 状态的解除可能需要等到 pendingOutput 被清空时
        // 但如果 isLastChunk 到了，至少可以认为后端数据发送完毕
        // 实际的 isResuming = false 最好在 pendingOutput 被写入终端后处理
        // 这里只记录日志，具体状态变更由 Terminal.vue 或相关 manager 负责
        log.info(
          `[${t('term.sshSuspend')}] (会话: ${payload.frontendSessionId}) isResuming 标记仍为 true，等待终端处理暂存数据（如有）。`,
        );
      }
    }
  } else {
    log.warn(
      `[${t('term.sshSuspend')}] 收到缓存数据块，但找不到对应会话或其终端管理器 (ID: ${payload.frontendSessionId})`,
    );
  }
};

const handleSshSuspendTerminated = (payload: SshSuspendTerminatedPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_TERMINATED:`, payload);
  if (payload.success) {
    const index = suspendedSshSessions.value.findIndex(
      (s) => s.suspendSessionId === payload.suspendSessionId,
    );
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.terminatedSuccess', {
          name: removedSession.customSuspendName || removedSession.connectionName,
        }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.terminateError', {
        error: payload.error || t('term.unknownError'),
      }),
    });
    log.error(
      `[${t('term.sshSuspend')}] 终止挂起会话失败 (ID: ${payload.suspendSessionId}): ${payload.error}`,
    );
  }
};

const handleSshSuspendEntryRemoved = (payload: SshSuspendEntryRemovedPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_ENTRY_REMOVED:`, payload);
  if (payload.success) {
    const index = suspendedSshSessions.value.findIndex(
      (s) => s.suspendSessionId === payload.suspendSessionId,
    );
    if (index !== -1) {
      const removedSession = suspendedSshSessions.value.splice(index, 1)[0];
      uiNotificationsStore.addNotification({
        type: 'info',
        message: t('sshSuspend.notifications.entryRemovedSuccess', {
          name: removedSession.customSuspendName || removedSession.connectionName,
        }),
      });
    }
  } else {
    uiNotificationsStore.addNotification({
      type: 'error',
      message: t('sshSuspend.notifications.entryRemovedError', {
        error: payload.error || t('term.unknownError'),
      }),
    });
    log.error(
      `[${t('term.sshSuspend')}] 移除挂起条目失败 (ID: ${payload.suspendSessionId}): ${payload.error}`,
    );
  }
};

// 名称编辑已迁移到 HTTP API，不再注册 WebSocket 处理器

const handleSshSuspendAutoTerminated = (payload: SshSuspendAutoTerminatedPayload): void => {
  const uiNotificationsStore = useUiNotificationsStore();
  log.info(`[${t('term.sshSuspend')}] 接到 SSH_SUSPEND_AUTO_TERMINATED:`, payload);
  const session = suspendedSshSessions.value.find(
    (s) => s.suspendSessionId === payload.suspendSessionId,
  );
  if (session) {
    session.backendSshStatus = 'disconnected_by_backend'; // 使用正确的字段名
    session.disconnectionTimestamp = new Date().toISOString(); // 更新为 ISO 字符串
    // 可以在 SuspendedSshSession 类型中添加 disconnectionReason 字段
    // session.disconnectionReason = payload.reason;
    uiNotificationsStore.addNotification({
      type: 'warning',
      message: t('sshSuspend.notifications.autoTerminated', {
        name: session.customSuspendName || session.connectionName,
        reason: payload.reason,
      }),
    });
  }
};

/**
 * 注册 SSH 挂起相关的 WebSocket 消息处理器。
 * 此函数应在 WebSocket 连接建立后，针对每个会话的 wsManager 实例调用。
 * @param wsManager 与特定 SSH 会话关联的 WebSocket 管理器实例
 */
export const registerSshSuspendHandlers = (wsManager: WsManagerInstance): void => {
  log.info(`[${t('term.sshSuspend')}] 尝试为 WebSocket 管理器注册 SSH 挂起处理器...`);

  if (!wsManager) {
    log.error(`[${t('term.sshSuspend')}] 注册处理器失败：wsManager 未定义。`);
    return;
  }

  // 注意：wsManager.onMessage 返回一个注销函数，如果需要，可以收集它们并在会话关闭时调用。
  // 但通常这些处理器会随 wsManager 实例的生命周期一起存在。
  wsManager.onMessage('SSH_MARKED_FOR_SUSPEND_ACK', (p: MessagePayload) =>
    handleSshMarkedForSuspendAck(p as unknown as SshMarkedForSuspendAckPayload),
  );
  wsManager.onMessage('SSH_UNMARKED_FOR_SUSPEND_ACK', (p: MessagePayload) =>
    handleSshUnmarkedForSuspendAck(p as unknown as SshUnmarkedForSuspendAckPayload),
  );
  wsManager.onMessage('SSH_SUSPEND_LIST_RESPONSE', (p: MessagePayload) =>
    handleSshSuspendListResponse(p as unknown as SshSuspendListResponsePayload),
  );
  wsManager.onMessage('SSH_SUSPEND_RESUMED', (p: MessagePayload) =>
    handleSshSuspendResumed(p as unknown as SshSuspendResumedPayload),
  );
  wsManager.onMessage('SSH_OUTPUT_CACHED_CHUNK', (p: MessagePayload) =>
    handleSshOutputCachedChunk(p as unknown as SshOutputCachedChunkPayload),
  );
  wsManager.onMessage('SSH_SUSPEND_TERMINATED', (p: MessagePayload) =>
    handleSshSuspendTerminated(p as unknown as SshSuspendTerminatedPayload),
  );
  wsManager.onMessage('SSH_SUSPEND_ENTRY_REMOVED', (p: MessagePayload) =>
    handleSshSuspendEntryRemoved(p as unknown as SshSuspendEntryRemovedPayload),
  );
  wsManager.onMessage('SSH_SUSPEND_AUTO_TERMINATED', (p: MessagePayload) =>
    handleSshSuspendAutoTerminated(p as unknown as SshSuspendAutoTerminatedPayload),
  );

  log.info(
    `[${t('term.sshSuspend')}] SSH 挂起模式的 WebSocket 消息处理器已注册 (移除了名称编辑相关的处理器)。`,
  );

  // 连接建立后，主动获取一次挂起列表。
  // 此处为 fire-and-forget 调用：必须捕获 rejection，避免在测试环境 teardown
  // （Pinia 已销毁、useUiNotificationsStore 抛错）或组件卸载后产生 unhandled rejection，
  // 导致 CI 间歇性报 "caught after test environment was torn down"。
  fetchSuspendedSshSessions().catch((error: unknown) => {
    log.error(`[${t('term.sshSuspend')}] 注册处理器后初始化获取挂起列表失败:`, error);
  });
};
