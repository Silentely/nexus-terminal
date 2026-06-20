/**
 * useTelnetTerminal Composable
 * 管理 Telnet 终端连接和数据流
 */

import { ref, onUnmounted } from 'vue';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { log } from '@/utils/log';

export interface TelnetTerminalOptions {
  container: HTMLElement;
  sessionId: string;
  connectionId: number;
  connectionName: string;
}

export function useTelnetTerminal() {
  // State
  const terminal = ref<Terminal | null>(null);
  const fitAddon = ref<FitAddon | null>(null);
  const isConnected = ref(false);
  const error = ref<string | null>(null);
  const sessionId = ref<string>('');

  // WebSocket
  let ws: WebSocket | null = null;
  let reconnectAttempts = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let intentionalDisconnect = false; // 标记是否为主动断开
  const maxReconnectAttempts = 3;

  /**
   * 初始化终端
   */
  function initTerminal(options: TelnetTerminalOptions): Terminal {
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      allowProposedApi: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });

    // 加载插件
    const fit = new FitAddon();
    const webLinks = new WebLinksAddon();
    term.loadAddon(fit);
    term.loadAddon(webLinks);

    // 挂载到容器
    term.open(options.container);
    fit.fit();

    // 保存引用
    terminal.value = term;
    fitAddon.value = fit;

    // 监听窗口大小变化
    resizeObserver = new ResizeObserver(() => {
      fit.fit();
    });
    resizeObserver.observe(options.container);

    // 连接 WebSocket
    connectWebSocket(options);

    return term;
  }

  /**
   * 连接 WebSocket
   */
  function connectWebSocket(options: TelnetTerminalOptions) {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      log.debug('[Telnet] WebSocket 已连接');
      reconnectAttempts = 0;

      // 发送 Telnet 连接请求
      ws?.send(
        JSON.stringify({
          type: 'telnet:connect',
          payload: { connectionId: options.connectionId },
        }),
      );
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        handleWebSocketMessage(message);
      } catch (err) {
        log.error('[Telnet] 消息解析失败:', err);
      }
    };

    ws.onclose = () => {
      log.debug('[Telnet] WebSocket 已断开');
      isConnected.value = false;

      // 仅在非主动断开时尝试重连
      if (!intentionalDisconnect && reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        reconnectTimer = setTimeout(() => connectWebSocket(options), 1000 * reconnectAttempts);
      }
    };

    ws.onerror = (err) => {
      log.error('[Telnet] WebSocket 错误:', err);
      error.value = 'WebSocket 连接错误';
    };
  }

  /**
   * 处理 WebSocket 消息
   */
  function handleWebSocketMessage(message: { type: string; payload?: unknown }) {
    switch (message.type) {
      case 'telnet:connected':
        isConnected.value = true;
        // 存储 sessionId 用于后续消息
        if (message.payload && typeof message.payload === 'object') {
          sessionId.value = (message.payload as { sessionId?: string }).sessionId || '';
        }
        log.debug('[Telnet] 连接成功:', message.payload);
        break;

      case 'telnet:output':
        // 终端输出数据
        if (terminal.value && message.payload) {
          const data = message.payload as string;
          // UTF-8 解码（支持中文/日文等多字节字符）
          const binaryString = atob(data);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          const decoded = new TextDecoder('utf-8').decode(bytes);
          terminal.value.write(decoded);
        }
        break;

      case 'telnet:disconnected':
        isConnected.value = false;
        log.debug('[Telnet] 连接已断开');
        break;

      case 'telnet:error':
        error.value = (message.payload as { message?: string })?.message || '未知错误';
        log.error('[Telnet] 错误:', message.payload);
        break;
    }
  }

  /**
   * 发送输入数据
   */
  function sendInput(data: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      log.warn('[Telnet] WebSocket 未就绪');
      return;
    }

    if (!sessionId.value) {
      log.warn('[Telnet] sessionId 未就绪，忽略输入');
      return;
    }

    // UTF-8 编码后 base64（支持中文/日文等 Unicode 字符）
    const encoder = new TextEncoder();
    const uint8Array = encoder.encode(data);
    // 使用分块编码确保正确性（每块 3 字节对齐）
    const chunkSize = 3 * 1024; // 3 的倍数，避免 padding 问题
    let encoded = '';
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const end = Math.min(i + chunkSize, uint8Array.length);
      const chunk = uint8Array.slice(i, end);
      encoded += btoa(String.fromCharCode(...chunk));
    }
    ws.send(
      JSON.stringify({
        type: 'telnet:input',
        payload: { sessionId: sessionId.value, data: encoded },
      }),
    );
  }

  /**
   * 发送窗口大小调整
   */
  function sendResize(cols: number, rows: number) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      return;
    }

    if (!sessionId.value) {
      return;
    }

    ws.send(
      JSON.stringify({
        type: 'telnet:resize',
        payload: { sessionId: sessionId.value, cols, rows },
      }),
    );
  }

  /**
   * 断开连接
   */
  function disconnect() {
    // 标记为主动断开，防止重连
    intentionalDisconnect = true;

    // 清理重连定时器
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // 清理 ResizeObserver
    if (resizeObserver) {
      resizeObserver.disconnect();
      resizeObserver = null;
    }

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(
        JSON.stringify({
          type: 'telnet:disconnect',
          payload: { sessionId: sessionId.value },
        }),
      );
    }
    ws?.close();
    ws = null;
    terminal.value?.dispose();
    terminal.value = null;
    fitAddon.value = null;
    isConnected.value = false;
  }

  // 清理
  onUnmounted(() => {
    disconnect();
  });

  return {
    terminal,
    isConnected,
    error,
    initTerminal,
    sendInput,
    sendResize,
    disconnect,
  };
}
