/**
 * 终端与 SSH 事件处理
 * 从 useSshTerminal.ts 提取，负责终端生命周期、SSH 输出和连接状态事件
 *
 * 职责：
 * - 终端就绪、输入、尺寸变化处理
 * - SSH 输出解码与缓冲
 * - SSH 连接/断开/错误/状态事件处理
 * - 后端 info/error 消息处理
 */

import { ref, type Ref } from 'vue';
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon } from '@xterm/addon-search';
import type { WebSocketMessage } from '../../types/websocket.types';
import type { createBufferManager } from './bufferManager';
import { sessions as globalSessionsRef } from '../../stores/session/state';
import { log } from '@/utils/log';

/** 事件处理器所需的外部依赖 */
export interface EventHandlerDeps {
  sessionId: string;
  sendMessage: (message: WebSocketMessage) => void;
  isConnected: Ref<boolean>;
  terminalInstance: Ref<Terminal | null>;
  searchAddon: Ref<SearchAddon | null>;
  bufferManager: ReturnType<typeof createBufferManager>;
  t: (key: string, params?: Record<string, unknown>) => string;
}

/**
 * 创建终端与 SSH 事件处理器
 */
export function createEventHandlers(deps: EventHandlerDeps) {
  const { sessionId, sendMessage, isConnected, terminalInstance, searchAddon, bufferManager, t } =
    deps;

  const isSshConnected = ref(false);

  /**
   * 获取终端消息文本（i18n 辅助）
   */
  const getTerminalText = (key: string, params?: Record<string, unknown>): string => {
    const translationKey = `workspace.terminal.${key}`;
    const translated = t(translationKey, params || {});
    return translated === translationKey ? key : translated;
  };

  // --- 终端事件处理 ---

  /**
   * 终端实例就绪事件
   * 处理 SessionState.pendingOutput 和内部缓冲数据
   */
  const handleTerminalReady = (payload: {
    terminal: Terminal;
    searchAddon: SearchAddon | null;
  }) => {
    const { terminal: term, searchAddon: addon } = payload;
    log.info(
      `[会话 ${sessionId}][SSH终端模块] 终端实例已就绪。SearchAddon 实例:`,
      addon ? '存在' : '不存在',
    );
    terminalInstance.value = term;
    searchAddon.value = addon;

    // 1. 处理 SessionState.pendingOutput (来自 SSH_OUTPUT_CACHED_CHUNK 的早期数据)
    const currentSessionState = globalSessionsRef.value.get(sessionId);
    if (
      currentSessionState &&
      currentSessionState.pendingOutput &&
      currentSessionState.pendingOutput.length > 0
    ) {
      currentSessionState.pendingOutput.forEach((data) => {
        term.write(data);
      });
      currentSessionState.pendingOutput = [];
      if (currentSessionState.isResuming) {
        currentSessionState.isResuming = false;
      }
    }

    // 2. 将内部缓冲的输出写入终端
    if (bufferManager.getLength() > 0) {
      bufferManager.flushBuffer();
    }
  };

  /**
   * 终端输入事件（来自 xterm.js 的用户输入）
   */
  const handleTerminalData = (data: string) => {
    sendMessage({ type: 'ssh:input', payload: data });
  };

  /**
   * 终端尺寸变化事件
   */
  const handleTerminalResize = (dimensions: { cols: number; rows: number }) => {
    if (isConnected.value) {
      sendMessage({ type: 'ssh:resize', sessionId, payload: dimensions });
    }
  };

  // --- WebSocket 消息处理 ---

  /**
   * 处理 SSH 输出数据（含 Base64 解码）
   */
  const handleSshOutput = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    let outputData: string | Uint8Array = payload as string | Uint8Array;

    // Base64 解码
    if (message?.encoding === 'base64' && typeof outputData === 'string') {
      try {
        const binaryString = atob(outputData);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        outputData = bytes;
      } catch (error: unknown) {
        log.error(`[会话 ${sessionId}][SSH终端模块] Base64 解码失败:`, error);
        outputData = `\r\n[解码错误: ${error}]\r\n`;
      }
    } else if (typeof outputData !== 'string') {
      try {
        outputData = JSON.stringify(outputData);
      } catch {
        outputData = String(outputData);
      }
    }

    // 通过缓冲管理器写入（自动处理小数据包直接写入和大数据包批量缓冲）
    bufferManager.push(outputData);
  };

  /**
   * 处理 SSH 连接成功
   */
  const handleSshConnected = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    isSshConnected.value = true;
    terminalInstance.value?.focus();

    if (terminalInstance.value) {
      const currentDimensions = {
        cols: terminalInstance.value.cols,
        rows: terminalInstance.value.rows,
      };
      if (currentDimensions.cols > 0 && currentDimensions.rows > 0) {
        sendMessage({ type: 'ssh:resize', sessionId, payload: currentDimensions });
      }
    }

    // 清空可能存在的旧缓冲
    if (bufferManager.getLength() > 0 && terminalInstance.value) {
      bufferManager.flushAllToTerminal(terminalInstance.value);
    }
  };

  /**
   * 处理 SSH 断开连接
   */
  const handleSshDisconnected = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    const reason =
      (typeof payload === 'string' ? payload : null) || t('workspace.terminal.unknownReason');
    isSshConnected.value = false;
    terminalInstance.value?.writeln(
      `\r\n\x1b[31m${getTerminalText('disconnectMsg', { reason })}\x1b[0m`,
    );
  };

  /**
   * 处理 SSH 错误
   */
  const handleSshError = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    const errorMsg =
      (typeof payload === 'string' ? payload : null) || t('workspace.terminal.unknownSshError');
    isSshConnected.value = false;
    terminalInstance.value?.writeln(
      `\r\n\x1b[31m${getTerminalText('genericErrorMsg', { message: errorMsg })}\x1b[0m`,
    );
  };

  /**
   * 处理 SSH 状态更新
   */
  const handleSshStatus = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    // 兼容后端两种 payload 格式：纯字符串 或 { key, params } 结构化对象
    if (typeof payload === 'string') {
      log.info(`[会话 ${sessionId}][SSH终端模块] 收到 SSH 状态更新:`, payload);
    } else if (typeof payload === 'object' && payload !== null) {
      const payloadObj = payload as Record<string, unknown>;
      const statusKey = payloadObj.key || 'unknown';
      const statusParams = payloadObj.params || {};
      log.info(`[会话 ${sessionId}][SSH终端模块] 收到 SSH 状态更新:`, statusKey, statusParams);
    } else {
      log.info(`[会话 ${sessionId}][SSH终端模块] 收到 SSH 状态更新:`, 'unknown');
    }
  };

  /**
   * 处理后端信息消息
   */
  const handleInfoMessage = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    const infoText = typeof payload === 'string' ? payload : String(payload ?? '');
    terminalInstance.value?.writeln(
      `\r\n\x1b[34m${getTerminalText('infoPrefix')} ${infoText}\x1b[0m`,
    );
  };

  /**
   * 处理后端通用错误消息
   */
  const handleErrorMessage = (payload: unknown, message?: WebSocketMessage) => {
    if (message?.sessionId && message.sessionId !== sessionId) return;

    const errorMsg =
      (typeof payload === 'string' ? payload : null) || t('workspace.terminal.unknownGenericError');
    terminalInstance.value?.writeln(
      `\r\n\x1b[31m${getTerminalText('errorPrefix')} ${errorMsg}\x1b[0m`,
    );
  };

  return {
    isSshConnected,
    handleTerminalReady,
    handleTerminalData,
    handleTerminalResize,
    handleSshOutput,
    handleSshConnected,
    handleSshDisconnected,
    handleSshError,
    handleSshStatus,
    handleInfoMessage,
    handleErrorMessage,
  };
}
