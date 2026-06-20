import { ref, readonly, type ComputedRef } from 'vue';
import { useI18n } from 'vue-i18n';
// import { useWebSocketConnection } from './useWebSocketConnection'; // 移除全局导入
import type { Terminal } from '@xterm/xterm';
import type { SearchAddon, ISearchOptions } from '@xterm/addon-search'; // *** 移除 ISearchResult 导入 ***
import { sessions as globalSessionsRef } from '../stores/session/state'; // +++ 导入全局 sessions state +++
import type { WebSocketMessage } from '../types/websocket.types';
import { log } from '@/utils/log';

// 定义与 WebSocket 相关的依赖接口
export interface SshTerminalDependencies {
  sendMessage: (message: WebSocketMessage) => void;
  onMessage: (
    type: string,
    handler: (payload: unknown, fullMessage?: WebSocketMessage) => void,
  ) => () => void;
  isConnected: ComputedRef<boolean>;
}

/**
 * 创建一个 SSH 终端管理器实例
 * @param sessionId 会话唯一标识符
 * @param wsDeps WebSocket 依赖对象
 * @param t i18n 翻译函数，从父组件传入
 * @returns SSH 终端管理器实例
 */
export function createSshTerminalManager(
  sessionId: string,
  wsDeps: SshTerminalDependencies,
  t: ReturnType<typeof useI18n>['t'],
) {
  // +++ Update type of t +++
  // 使用依赖注入的 WebSocket 函数
  const { sendMessage, onMessage, isConnected } = wsDeps;

  const terminalInstance = ref<Terminal | null>(null);
  const searchAddon = ref<SearchAddon | null>(null); // Keep searchAddon ref
  // Removed search result state refs
  // const searchResultCount = ref(0);
  // const currentSearchResultIndex = ref(-1);
  const terminalOutputBuffer = ref<(string | Uint8Array)[]>([]); // 缓冲 WebSocket 消息直到终端准备好
  const isSshConnected = ref(false); // 跟踪 SSH 连接状态

  // 合并 Uint8Array 的阈值（超过此值逐块写入，避免昂贵的大数组分配）
  const MERGE_THRESHOLD_BYTES = 512 * 1024; // 512KB

  // 缓冲区大小上限，防止高吞吐终端输出下无限增长
  const MAX_BUFFER_SIZE_BYTES = 10 * 1024 * 1024; // 10MB
  let currentBufferSizeBytes = 0;

  const getItemByteSize = (item: string | Uint8Array): number => {
    if (typeof item === 'string') {
      // 字符串按 UTF-16 编码估算字节数（每个字符最多 4 字节，保守用 2 字节）
      return item.length * 2;
    }
    return item.byteLength;
  };

  const trimBuffer = (): void => {
    let trimmedCount = 0;
    while (
      currentBufferSizeBytes > MAX_BUFFER_SIZE_BYTES &&
      terminalOutputBuffer.value.length > 0
    ) {
      const removed = terminalOutputBuffer.value.shift();
      if (removed) {
        currentBufferSizeBytes -= getItemByteSize(removed);
        trimmedCount++;
      }
    }
    // 缓冲区截断时向终端输出提示信息
    if (trimmedCount > 0 && terminalInstance.value) {
      terminalInstance.value.writeln(
        `\r\n\x1b[33m[终端输出已截断：丢弃了 ${trimmedCount} 条旧数据以释放缓冲区]\x1b[0m`,
      );
    }
  };

  // +++ Throttling State +++
  let isFlushing = false;
  let flushScheduled = false;
  let lastFlushTime = 0;
  const FLUSH_INTERVAL_MS = 16; // 约 60fps，减少写入频率
  const IDLE_CALLBACK_TIMEOUT_MS = 50; // requestIdleCallback 超时
  const SMALL_DATA_THRESHOLD = 100; // 小数据包阈值（字节），用于识别用户输入
  const idleWindow = window as Window &
    typeof globalThis & {
      requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    };

  /**
   * 调度空闲任务：优先使用 requestIdleCallback（Safari 降级到 rAF）
   * 封装 Safari 兼容性逻辑，便于单元测试和复用
   */
  const scheduleIdleTask = (callback: () => void, timeout = IDLE_CALLBACK_TIMEOUT_MS): void => {
    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(
        (deadline: IdleDeadline) => {
          if (deadline.timeRemaining() > 0 || deadline.didTimeout) {
            callback();
          } else {
            requestAnimationFrame(callback);
          }
        },
        { timeout },
      );
    } else {
      // Safari 等不支持 requestIdleCallback 的浏览器降级到 rAF
      requestAnimationFrame(callback);
    }
  };

  // 合并 Uint8Array 数组为单个 Uint8Array（超过阈值时逐块写入，避免昂贵的大数组分配）
  const mergeUint8Arrays = (arrays: Uint8Array[]): Uint8Array | null => {
    const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
    // 超过阈值时不合并，返回 null 由调用方逐块写入
    if (totalLength > MERGE_THRESHOLD_BYTES) return null;
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  };

  /**
   * 将 Uint8Array 数组逐块写入终端（用于超过合并阈值的大数据）
   */
  const writeUint8ArraysIndividually = (arrays: Uint8Array[]): void => {
    const terminal = terminalInstance.value;
    if (!terminal) return;
    for (const arr of arrays) {
      terminal.write(arr);
    }
  };

  // 执行实际的缓冲区写入
  const doFlush = () => {
    if (!terminalInstance.value || terminalOutputBuffer.value.length === 0) {
      isFlushing = false;
      flushScheduled = false;
      return;
    }

    const buffer = terminalOutputBuffer.value;
    terminalOutputBuffer.value = []; // 先清空，避免竞态
    currentBufferSizeBytes = 0;

    // 合并所有数据后一次性写入，减少 DOM 操作
    if (buffer.length === 1) {
      terminalInstance.value.write(buffer[0]);
    } else {
      const allStrings = buffer.every((item) => typeof item === 'string');
      const allUint8Arrays = buffer.every((item) => item instanceof Uint8Array);

      if (allStrings) {
        // 字符串批量合并
        terminalInstance.value.write((buffer as string[]).join(''));
      } else if (allUint8Arrays) {
        // Uint8Array 批量合并（大数据时逐块写入，避免昂贵的大数组分配）
        const merged = mergeUint8Arrays(buffer as Uint8Array[]);
        if (merged) {
          terminalInstance.value.write(merged);
        } else {
          writeUint8ArraysIndividually(buffer as Uint8Array[]);
        }
      } else {
        // 混合类型：分组处理，减少写入次数
        let strBatch = '';
        let uint8Batch: Uint8Array[] = [];

        const flushStrBatch = () => {
          const terminal = terminalInstance.value;
          if (strBatch && terminal) {
            terminal.write(strBatch);
            strBatch = '';
          }
        };
        const flushUint8Batch = () => {
          const terminal = terminalInstance.value;
          if (uint8Batch.length > 0 && terminal) {
            if (uint8Batch.length === 1) {
              terminal.write(uint8Batch[0]);
            } else {
              const merged = mergeUint8Arrays(uint8Batch);
              if (merged) {
                terminal.write(merged);
              } else {
                writeUint8ArraysIndividually(uint8Batch);
              }
            }
            uint8Batch = [];
          }
        };

        for (const chunk of buffer) {
          if (typeof chunk === 'string') {
            flushUint8Batch();
            strBatch += chunk;
          } else {
            flushStrBatch();
            uint8Batch.push(chunk);
          }
        }
        flushStrBatch();
        flushUint8Batch();
      }
    }

    lastFlushTime = performance.now();
    isFlushing = false;
    flushScheduled = false;

    // 如果写入期间有新数据到达，安排下一次刷新
    if (terminalOutputBuffer.value.length > 0) {
      scheduleFlush();
    }
  };

  // 安排刷新：使用 requestIdleCallback 优先处理非紧急输出（Safari 自动降级到 rAF）
  const scheduleFlush = () => {
    if (flushScheduled) return;
    flushScheduled = true;

    const timeSinceLastFlush = performance.now() - lastFlushTime;

    // 如果距离上次刷新时间较短，使用 scheduleIdleTask 延迟处理
    if (timeSinceLastFlush < FLUSH_INTERVAL_MS) {
      scheduleIdleTask(doFlush);
    } else {
      // 首次刷新或距上次刷新时间足够长，直接使用 rAF
      requestAnimationFrame(doFlush);
    }
  };

  // 兼容旧逻辑的 flushBuffer 函数
  const flushBuffer = () => {
    if (!terminalInstance.value || terminalOutputBuffer.value.length === 0) {
      isFlushing = false;
      return;
    }
    isFlushing = true;
    scheduleFlush();
  };

  // 辅助函数：获取终端消息文本
  const getTerminalText = (key: string, params?: Record<string, unknown>): string => {
    // 确保 i18n key 存在，否则返回原始 key
    const translationKey = `workspace.terminal.${key}`;
    const translated = t(translationKey, params || {});
    return translated === translationKey ? key : translated;
  };

  // --- 终端事件处理 ---

  // *** 更新 handleTerminalReady 签名以接收 searchAddon ***
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
    searchAddon.value = addon; // *** 存储 searchAddon 实例 ***

    // 1. 处理 SessionState.pendingOutput (来自 SSH_OUTPUT_CACHED_CHUNK 的早期数据)
    const currentSessionState = globalSessionsRef.value.get(sessionId);
    if (
      currentSessionState &&
      currentSessionState.pendingOutput &&
      currentSessionState.pendingOutput.length > 0
    ) {
      // log.info(`[会话 ${sessionId}][SSH终端模块] 发现 SessionState.pendingOutput，长度: ${currentSessionState.pendingOutput.length}。正在写入...`);
      currentSessionState.pendingOutput.forEach((data) => {
        term.write(data);
      });
      currentSessionState.pendingOutput = []; // 清空
      // log.info(`[会话 ${sessionId}][SSH终端模块] SessionState.pendingOutput 处理完毕。`);
      // 如果之前因为 pendingOutput 而将 isResuming 保持为 true，现在可以考虑更新
      if (currentSessionState.isResuming) {
        // 检查 isLastChunk 是否已收到 (这部分逻辑在 handleSshOutputCachedChunk 中，这里仅作标记清除)
        // 假设所有缓存块都已处理完毕
        // log.info(`[会话 ${sessionId}][SSH终端模块] 所有 pendingOutput 已写入，清除 isResuming 标记。`);
        currentSessionState.isResuming = false;
      }
    }

    // 2. 将此管理器内部缓冲的输出 (terminalOutputBuffer, 来自 ssh:output) 写入终端
    if (terminalOutputBuffer.value.length > 0) {
      // +++ Trigger flush loop +++
      if (!isFlushing) {
        isFlushing = true;
        requestAnimationFrame(flushBuffer);
      }
    }

    // 可以在这里自动聚焦或执行其他初始化操作
    // term.focus(); // 也许在 ssh:connected 时聚焦更好
  };

  const handleTerminalData = (data: string) => {
    // log.debug(`[会话 ${sessionId}][SSH终端模块] 接收到终端输入:`, data);
    // 注意：后端期望 payload 直接是字符串
    sendMessage({ type: 'ssh:input', payload: data });
  };

  const handleTerminalResize = (dimensions: { cols: number; rows: number }) => {
    log.info(`[SSH ${sessionId}] handleTerminalResize called with:`, dimensions);
    // 只有在连接状态下才发送 resize 命令给后端
    if (isConnected.value) {
      sendMessage({ type: 'ssh:resize', sessionId, payload: dimensions });
    } else {
      log.info(`[SSH ${sessionId}] WebSocket not connected, skipping ssh:resize.`);
    }
  };

  // --- WebSocket 消息处理 ---

  const handleSshOutput = (payload: unknown, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    let outputData: string | Uint8Array = payload as string | Uint8Array;
    // 检查是否为 Base64 编码 (需要后端配合发送 encoding 字段)
    if (message?.encoding === 'base64' && typeof outputData === 'string') {
      try {
        // 使用更安全的Base64解码方式，保证中文字符正确解码
        const base64String = outputData;
        // 先用atob获取二进制字符串
        const binaryString = atob(base64String);
        // 创建Uint8Array存储二进制数据
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        // 直接使用原始二进制数据作为 Uint8Array 写入终端，避免编码转换问题
        outputData = bytes;
      } catch (error: unknown) {
        log.error(
          `[会话 ${sessionId}][SSH终端模块] Base64 解码失败:`,
          error,
          '原始数据:',
          message.payload,
        );
        outputData = `\r\n[解码错误: ${error}]\r\n`; // 在终端显示解码错误
      }
    }
    // 如果不是 base64 或解码失败，确保它是字符串
    else if (typeof outputData !== 'string') {
      log.warn(`[会话 ${sessionId}][SSH终端模块] 收到非字符串 ssh:output payload:`, outputData);
      try {
        outputData = JSON.stringify(outputData); // 尝试序列化
      } catch {
        outputData = String(outputData); // 最后手段：强制转字符串
      }
    }

    // 由于直接使用原始二进制数据，不再需要过滤 OSC 184 序列
    // 相关代码已移除

    // --- 添加前端日志 ---
    // log.info(`[会话 ${sessionId}][SSH前端] 收到 ssh:output 原始 payload (解码前):`, payload);
    // log.info(`[会话 ${sessionId}][SSH前端] 解码后的数据 (尝试写入):`, outputData);
    // --------------------

    // +++ 优化：区分小数据包（用户输入回显）和大数据包（服务器输出） +++
    let dataSize = 0;
    if (typeof outputData === 'string' || outputData instanceof Uint8Array) {
      dataSize = outputData.length;
    }

    // 小数据包（通常是用户输入回显）仅在缓冲队列为空时立即写入，否则进入队列保持顺序
    if (
      dataSize > 0 &&
      dataSize <= SMALL_DATA_THRESHOLD &&
      terminalOutputBuffer.value.length === 0 &&
      terminalInstance.value
    ) {
      terminalInstance.value.write(outputData);
      return;
    }

    // 大数据包或缓冲队列非空时，数据进入队列使用批量缓冲策略
    terminalOutputBuffer.value.push(outputData);
    currentBufferSizeBytes += getItemByteSize(outputData);
    trimBuffer(); // 超出上限时丢弃最旧条目

    if (terminalInstance.value) {
      if (!isFlushing) {
        isFlushing = true;
        requestAnimationFrame(flushBuffer);
      }
    }
    // If terminalInstance is not ready, data sits in terminalOutputBuffer until handleTerminalReady calls flushBuffer (or manual logic there)
  };

  const handleSshConnected = (payload: unknown, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    log.info(
      `[会话 ${sessionId}][SSH终端模块] SSH 会话已连接。 Payload:`,
      payload,
      'Full message:',
      message,
    ); // 更详细的日志
    isSshConnected.value = true; // 更新状态
    // 连接成功后聚焦终端
    terminalInstance.value?.focus();

    if (terminalInstance.value) {
      const currentDimensions = {
        cols: terminalInstance.value.cols,
        rows: terminalInstance.value.rows,
      };
      // 检查尺寸是否有效
      if (currentDimensions.cols > 0 && currentDimensions.rows > 0) {
        log.info(
          `[会话 ${sessionId}][SSH终端模块] SSH 连接成功，主动发送初始尺寸:`,
          currentDimensions,
        );
        sendMessage({ type: 'ssh:resize', sessionId, payload: currentDimensions });
      } else {
        log.warn(
          `[会话 ${sessionId}][SSH终端模块] SSH 连接成功，但获取到的初始尺寸无效，跳过发送 resize:`,
          currentDimensions,
        );
      }
    } else {
      log.warn(
        `[会话 ${sessionId}][SSH终端模块] SSH 连接成功，但 terminalInstance 不可用，无法发送初始 resize。`,
      );
    }

    // 清空可能存在的旧缓冲（虽然理论上此时应该已经 ready 了）
    if (terminalOutputBuffer.value.length > 0) {
      log.warn(`[会话 ${sessionId}][SSH终端模块] SSH 连接时仍有缓冲数据，正在写入...`);
      terminalOutputBuffer.value.forEach((data) => terminalInstance.value?.write(data));
      terminalOutputBuffer.value = [];
      currentBufferSizeBytes = 0;
    }
  };

  const handleSshDisconnected = (payload: unknown, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    const reason =
      (typeof payload === 'string' ? payload : null) || t('workspace.terminal.unknownReason'); // 使用 i18n 获取未知原因文本
    log.info(`[会话 ${sessionId}][SSH终端模块] SSH 会话已断开:`, reason);
    isSshConnected.value = false; // 更新状态
    terminalInstance.value?.writeln(
      `\r\n\x1b[31m${getTerminalText('disconnectMsg', { reason })}\x1b[0m`,
    );
    // 可以在这里添加其他清理逻辑，例如禁用输入
  };

  const handleSshError = (payload: unknown, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    const errorMsg =
      (typeof payload === 'string' ? payload : null) || t('workspace.terminal.unknownSshError'); // 使用 i18n
    log.error(`[会话 ${sessionId}][SSH终端模块] SSH 错误:`, errorMsg);
    isSshConnected.value = false; // 更新状态
    terminalInstance.value?.writeln(
      `\r\n\x1b[31m${getTerminalText('genericErrorMsg', { message: errorMsg })}\x1b[0m`,
    );
  };

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

  const handleInfoMessage = (payload: unknown, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    const infoText = typeof payload === 'string' ? payload : String(payload ?? '');
    log.info(`[会话 ${sessionId}][SSH终端模块] 收到后端信息:`, payload);
    terminalInstance.value?.writeln(
      `\r\n\x1b[34m${getTerminalText('infoPrefix')} ${infoText}\x1b[0m`,
    );
  };

  const handleErrorMessage = (payload: unknown, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    // 通用错误也可能需要显示在终端
    const errorMsg =
      (typeof payload === 'string' ? payload : null) || t('workspace.terminal.unknownGenericError'); // 使用 i18n
    log.error(`[会话 ${sessionId}][SSH终端模块] 收到后端通用错误:`, errorMsg);
    terminalInstance.value?.writeln(
      `\r\n\x1b[31m${getTerminalText('errorPrefix')} ${errorMsg}\x1b[0m`,
    );
  };

  // --- 注册 WebSocket 消息处理器 ---
  const unregisterHandlers: (() => void)[] = [];

  const registerSshHandlers = () => {
    unregisterHandlers.push(onMessage('ssh:output', handleSshOutput));
    unregisterHandlers.push(onMessage('ssh:connected', handleSshConnected));
    unregisterHandlers.push(onMessage('ssh:disconnected', handleSshDisconnected));
    unregisterHandlers.push(onMessage('ssh:error', handleSshError));
    unregisterHandlers.push(onMessage('ssh:status', handleSshStatus));
    unregisterHandlers.push(onMessage('info', handleInfoMessage));
    unregisterHandlers.push(onMessage('error', handleErrorMessage)); // 也处理通用错误
    log.info(`[会话 ${sessionId}][SSH终端模块] 已注册 SSH 相关消息处理器。`);
  };

  const unregisterAllSshHandlers = () => {
    log.info(`[会话 ${sessionId}][SSH终端模块] 注销 SSH 相关消息处理器...`);
    unregisterHandlers.forEach((unregister) => unregister?.());
    unregisterHandlers.length = 0; // 清空数组
  };

  // 初始化时自动注册处理程序
  registerSshHandlers();

  // --- 清理函数 ---
  const cleanup = () => {
    unregisterAllSshHandlers();
    // terminalInstance.value?.dispose(); // 终端实例的销毁由 TerminalComponent 负责
    terminalInstance.value = null;
    log.info(`[会话 ${sessionId}][SSH终端模块] 已清理。`);
  };

  /**
   * 直接发送数据到 SSH 会话 (例如，从命令输入栏)
   * @param data 要发送的字符串数据
   */
  const sendData = (data: string) => {
    // log.debug(`[会话 ${sessionId}][SSH终端模块] 直接发送数据:`, data);
    // 注意：后端期望 payload 直接是字符串
    sendMessage({ type: 'ssh:input', payload: data });
  };

  // --- 搜索相关方法 (移除计数逻辑) ---

  // Removed countOccurrences helper function

  const searchNext = (term: string, options?: ISearchOptions): boolean => {
    if (searchAddon.value) {
      log.info(`[会话 ${sessionId}][SSH终端模块] 执行 searchNext: "${term}"`);
      const found = searchAddon.value.findNext(term, options);
      // Removed manual count and state update
      return found;
    }
    log.warn(`[会话 ${sessionId}][SSH终端模块] searchNext 调用失败，searchAddon 不可用。`);
    // Removed state reset on failure
    return false;
  };

  const searchPrevious = (term: string, options?: ISearchOptions): boolean => {
    if (searchAddon.value) {
      log.info(`[会话 ${sessionId}][SSH终端模块] 执行 searchPrevious: "${term}"`);
      const found = searchAddon.value.findPrevious(term, options);
      // Removed manual count and state update
      return found;
    }
    log.warn(`[会话 ${sessionId}][SSH终端模块] searchPrevious 调用失败，searchAddon 不可用。`);
    // Removed state reset on failure
    return false;
  };

  const clearTerminalSearch = () => {
    if (searchAddon.value) {
      log.info(`[会话 ${sessionId}][SSH终端模块] 清除搜索高亮。`);
      searchAddon.value.clearDecorations();
    }
    // Removed state reset
    log.info(`[会话 ${sessionId}][SSH终端模块] 搜索高亮已清除 (状态不再管理)。`);
  };

  // 返回工厂实例
  return {
    // 公共接口
    handleTerminalReady,
    handleTerminalData, // 这个处理来自 xterm.js 的输入
    handleTerminalResize,
    sendData, // 允许外部直接发送数据
    cleanup,
    // --- 搜索方法 ---
    searchNext,
    searchPrevious,
    clearTerminalSearch,
    // --- 暴露状态 ---
    isSshConnected: readonly(isSshConnected), // 暴露 SSH 连接状态 (只读)
    terminalInstance, // 暴露 terminal 实例，以便 WorkspaceView 可以写入提示信息
  };
}
