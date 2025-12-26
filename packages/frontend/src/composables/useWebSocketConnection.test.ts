/**
 * useWebSocketConnection Composable 单元测试
 * 测试 WebSocket 连接管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach, Mock } from 'vitest';
import { createWebSocketConnectionManager } from './useWebSocketConnection';

// Mock vue-i18n
vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<any>('vue-i18n');
  return {
    ...actual,
    useI18n: () => ({
      t: (key: string, params?: Record<string, any>) => {
        if (params) return `${key}:${JSON.stringify(params)}`;
        return key;
      },
    }),
  };
});

// Mock CloseEvent (Node.js 环境可能没有)
class MockCloseEvent extends Event {
  code: number;
  reason: string;
  wasClean: boolean;
  constructor(type: string, init?: { code?: number; reason?: string; wasClean?: boolean }) {
    super(type);
    this.code = init?.code ?? 1000;
    this.reason = init?.reason ?? '';
    this.wasClean = init?.wasClean ?? true;
  }
}

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  url: string;
  readyState: number = MockWebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  constructor(url: string) {
    this.url = url;
  }

  send = vi.fn();

  close(code?: number, reason?: string) {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new MockCloseEvent('close', { code: code ?? 1000, reason }) as CloseEvent);
    }
  }

  // 模拟触发事件的辅助方法
  simulateOpen() {
    this.readyState = MockWebSocket.OPEN;
    if (this.onopen) {
      this.onopen(new Event('open'));
    }
  }

  simulateMessage(data: any) {
    if (this.onmessage) {
      this.onmessage(new MessageEvent('message', { data: JSON.stringify(data) }));
    }
  }

  simulateError() {
    if (this.onerror) {
      this.onerror(new Event('error'));
    }
  }

  simulateClose(code: number = 1000, reason: string = '') {
    this.readyState = MockWebSocket.CLOSED;
    if (this.onclose) {
      this.onclose(new MockCloseEvent('close', { code, reason }) as CloseEvent);
    }
  }
}

// 保存原始 WebSocket 引用
const OriginalWebSocket = global.WebSocket;

describe('useWebSocketConnection (createWebSocketConnectionManager)', () => {
  let mockT: (key: string, params?: Record<string, any>) => string;
  let createdWebSockets: MockWebSocket[];
  const createManager = (options?: {
    isResumeFlow?: boolean;
    getIsMarkedForSuspend?: () => boolean;
  }) => createWebSocketConnectionManager('session-1', '1', mockT, options);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    createdWebSockets = [];

    // 模拟 i18n 翻译函数
    mockT = (key: string, params?: Record<string, any>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    };

    // Mock 全局 WebSocket
    (global as any).WebSocket = vi.fn((url: string) => {
      const mockWs = new MockWebSocket(url);
      createdWebSockets.push(mockWs);
      return mockWs;
    });
    (global as any).WebSocket.CONNECTING = 0;
    (global as any).WebSocket.OPEN = 1;
    (global as any).WebSocket.CLOSING = 2;
    (global as any).WebSocket.CLOSED = 3;

    // Mock window.location
    Object.defineProperty(window, 'location', {
      value: { protocol: 'http:' },
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    global.WebSocket = OriginalWebSocket;
  });

  describe('初始状态', () => {
    it('应返回正确的初始状态', () => {
      const manager = createManager();

      expect(manager.isConnected.value).toBe(false);
      expect(manager.isSftpReady.value).toBe(false);
      expect(manager.connectionStatus.value).toBe('disconnected');
      expect(manager.statusMessage.value).toBe('');
    });

    it('应暴露所需的方法', () => {
      const manager = createManager();

      expect(typeof manager.connect).toBe('function');
      expect(typeof manager.disconnect).toBe('function');
      expect(typeof manager.sendMessage).toBe('function');
      expect(typeof manager.onMessage).toBe('function');
    });
  });

  describe('connect', () => {
    it('应创建 WebSocket 连接', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');

      expect(global.WebSocket).toHaveBeenCalledWith('ws://localhost:3001');
      expect(manager.connectionStatus.value).toBe('connecting');
    });

    it('HTTPS 页面应自动升级为 wss 协议', () => {
      (window as any).location.protocol = 'https:';
      const manager = createManager();

      manager.connect('ws://localhost:3001');

      expect(global.WebSocket).toHaveBeenCalledWith('wss://localhost:3001');
    });

    it('连接成功后应发送 ssh:connect 消息', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'ssh:connect',
          payload: { connectionId: 1 },
        })
      );
    });

    it('恢复流程模式下不应发送 ssh:connect', () => {
      const manager = createManager({
        isResumeFlow: true,
      });

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      expect(ws.send).not.toHaveBeenCalled();
      expect(manager.connectionStatus.value).toBe('connected');
    });

    it('已连接时不应创建新连接', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      // 尝试再次连接
      manager.connect('ws://localhost:3001');

      // 应该只创建了一个 WebSocket
      expect(createdWebSockets.length).toBe(1);
    });
  });

  describe('消息处理', () => {
    it('ssh:connected 应更新连接状态', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      expect(manager.isConnected.value).toBe(false);

      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(manager.isConnected.value).toBe(true);
      expect(manager.connectionStatus.value).toBe('connected');
    });

    it('ssh:disconnected 应更新连接状态', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(manager.isConnected.value).toBe(true);

      ws.simulateMessage({ type: 'ssh:disconnected', payload: 'Connection closed' });

      expect(manager.isConnected.value).toBe(false);
      expect(manager.connectionStatus.value).toBe('disconnected');
    });

    it('ssh:error 应更新为错误状态', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      ws.simulateMessage({ type: 'ssh:error', payload: 'Authentication failed' });

      expect(manager.connectionStatus.value).toBe('error');
      expect(manager.isSftpReady.value).toBe(false);
    });

    it('sftp_ready 应更新 SFTP 状态', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(manager.isSftpReady.value).toBe(false);

      ws.simulateMessage({ type: 'sftp_ready', payload: {} });

      expect(manager.isSftpReady.value).toBe(true);
    });

    it('未知消息类型应被忽略', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('unknown:type', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      ws.simulateMessage({ type: 'unknown:type', payload: {} });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onMessage 消息处理器', () => {
    it('应注册消息处理器', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('ssh:connected', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: { test: 'data' } });

      expect(handler).toHaveBeenCalledWith({ test: 'data' }, expect.any(Object));
    });

    it('应返回注销函数', () => {
      const manager = createManager();
      const handler = vi.fn();

      const unregister = manager.onMessage('ssh:connected', handler);

      // 注销处理器
      unregister();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(handler).not.toHaveBeenCalled();
    });

    it('应支持同一类型的多个处理器', () => {
      const manager = createManager();
      const handler1 = vi.fn();
      const handler2 = vi.fn();

      manager.onMessage('ssh:connected', handler1);
      manager.onMessage('ssh:connected', handler2);

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(handler1).toHaveBeenCalled();
      expect(handler2).toHaveBeenCalled();
    });

    it('处理器抛出错误不应影响其他处理器', () => {
      const manager = createManager();
      const errorHandler = vi.fn(() => {
        throw new Error('Test error');
      });
      const normalHandler = vi.fn();

      manager.onMessage('ssh:connected', errorHandler);
      manager.onMessage('ssh:connected', normalHandler);

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(errorHandler).toHaveBeenCalled();
      expect(normalHandler).toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('连接打开时应发送消息', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      manager.sendMessage({ type: 'test:message', payload: { data: 'test' } });

      expect(ws.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'test:message', payload: { data: 'test' } })
      );
    });

    it('连接未打开时不应发送消息', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      // 不调用 simulateOpen()

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      manager.sendMessage({ type: 'test:message', payload: {} });

      expect(ws.send).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('disconnect', () => {
    it('应关闭 WebSocket 连接', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateMessage({ type: 'ssh:connected', payload: {} });

      expect(manager.isConnected.value).toBe(true);

      manager.disconnect();

      expect(manager.connectionStatus.value).toBe('disconnected');
      expect(manager.isSftpReady.value).toBe(false);
    });

    it('断开后不应触发自动重连', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      manager.disconnect();

      // 快进重连延迟
      vi.advanceTimersByTime(60000);

      // 不应创建新连接
      expect(createdWebSockets.length).toBe(1);
    });
  });

  describe('自动重连', () => {
    it('连接错误后应自动重连', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateError();

      expect(manager.connectionStatus.value).toBe('connecting');

      // 快进第一次重连延迟 (2秒)
      vi.advanceTimersByTime(2000);

      expect(createdWebSockets.length).toBe(2);
    });

    it('应使用指数退避延迟', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      let ws = createdWebSockets[0];
      ws.simulateError();

      // 第一次重连 (2^1 * 1000 = 2s)
      vi.advanceTimersByTime(2000);
      expect(createdWebSockets.length).toBe(2);

      ws = createdWebSockets[1];
      ws.simulateError();

      // 第二次重连 (2^2 * 1000 = 4s)
      vi.advanceTimersByTime(4000);
      expect(createdWebSockets.length).toBe(3);

      ws = createdWebSockets[2];
      ws.simulateError();

      // 第三次重连 (2^3 * 1000 = 8s)
      vi.advanceTimersByTime(8000);
      expect(createdWebSockets.length).toBe(4);
    });

    it('达到最大重试次数后应停止重连', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');

      // 模拟 5 次连续失败（第一次连接 + 5 次重连尝试）
      // maxReconnectAttempts = 5
      for (let i = 0; i < 6; i++) {
        const ws = createdWebSockets[createdWebSockets.length - 1];
        ws.simulateError();
        // 快进重连延迟 (2^(i+1) * 1000)
        vi.advanceTimersByTime(2 ** (i + 1) * 1000 + 100);
      }

      const finalCount = createdWebSockets.length;

      // 再等待更多时间
      vi.advanceTimersByTime(120000);

      // 不应再有新连接
      expect(createdWebSockets.length).toBe(finalCount);
      // 最后状态应该是 error（因为达到了最大重试次数）
      // 注意：最后一次 error 后，scheduleReconnect 检测到超过 maxReconnectAttempts，
      // 会设置 status 为 'error'
    });

    it('标记为挂起时不应重连', () => {
      const getIsMarkedForSuspend = vi.fn(() => true);
      const manager = createManager({
        getIsMarkedForSuspend,
      });

      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateClose(1006, 'Connection lost');

      // 快进重连延迟
      vi.advanceTimersByTime(60000);

      // 不应创建新连接
      expect(createdWebSockets.length).toBe(1);
      expect(manager.connectionStatus.value).toBe('disconnected');
    });
  });

  describe('内部事件分发', () => {
    it('连接打开时应分发 internal:opened 事件', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('internal:opened', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      expect(handler).toHaveBeenCalled();
    });

    it('连接关闭时应分发 internal:closed 事件', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('internal:closed', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();
      ws.simulateClose(1000, 'Normal closure');

      expect(handler).toHaveBeenCalledWith(
        { code: 1000, reason: 'Normal closure' },
        expect.any(Object)
      );
    });

    it('连接错误时应分发 internal:error 事件', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('internal:error', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateError();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('Payload 验证', () => {
    it('应验证 terminal:data 的 payload', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('terminal:data', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      // 有效的 payload
      ws.simulateMessage({ type: 'terminal:data', payload: 'test data' });
      expect(handler).toHaveBeenCalled();

      handler.mockClear();

      // 无效的 payload（应该是字符串）
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      ws.simulateMessage({ type: 'terminal:data', payload: { invalid: true } });
      expect(handler).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('应验证 terminal:resize 的 payload', () => {
      const manager = createManager();
      const handler = vi.fn();

      manager.onMessage('terminal:resize', handler);
      manager.connect('ws://localhost:3001');
      const ws = createdWebSockets[0];
      ws.simulateOpen();

      // 有效的 payload
      ws.simulateMessage({ type: 'terminal:resize', payload: { cols: 80, rows: 24 } });
      expect(handler).toHaveBeenCalled();

      handler.mockClear();

      // 无效的 payload
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      ws.simulateMessage({ type: 'terminal:resize', payload: { cols: '80' } });
      expect(handler).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('状态不一致处理', () => {
    it('检测到状态不一致时应关闭旧连接', () => {
      const manager = createManager();

      manager.connect('ws://localhost:3001');
      const ws1 = createdWebSockets[0];
      ws1.simulateOpen();

      // 模拟状态不一致：WebSocket 仍然打开但状态被外部改变
      // 这种情况在实际代码中是通过 disconnect 后再 connect 发生的
      manager.disconnect();

      // 现在重新连接
      manager.connect('ws://localhost:3001');

      // 应该创建了新的 WebSocket
      expect(createdWebSockets.length).toBe(2);
    });
  });
});
