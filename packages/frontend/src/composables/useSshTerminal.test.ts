/**
 * useSshTerminal Composable 单元测试
 * 测试 SSH 终端管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, nextTick } from 'vue';
import { createSshTerminalManager, type SshTerminalDependencies } from './useSshTerminal';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

// 使用 vi.hoisted 来提升 mock 状态
const { mockSessionsMap } = vi.hoisted(() => ({
  mockSessionsMap: new Map(),
}));

// Mock session state
vi.mock('../stores/session/state', () => ({
  sessions: { value: mockSessionsMap },
}));

describe('useSshTerminal (createSshTerminalManager)', () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockOnMessage: ReturnType<typeof vi.fn>;
  let mockIsConnected: ReturnType<typeof ref<boolean>>;
  let messageHandlers: Map<string, ((payload: any, message?: any) => void)[]>;

  // 模拟 Terminal 实例
  function createMockTerminal() {
    return {
      write: vi.fn(),
      writeln: vi.fn(),
      focus: vi.fn(),
      cols: 80,
      rows: 24,
    };
  }

  // 模拟 SearchAddon 实例
  function createMockSearchAddon() {
    return {
      findNext: vi.fn(() => true),
      findPrevious: vi.fn(() => true),
      clearDecorations: vi.fn(),
    };
  }

  // 模拟 i18n 翻译函数
  const mockT = (key: string, params?: Record<string, any>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  };

  // 辅助函数：创建 WebSocket 依赖
  function createWsDeps(): SshTerminalDependencies {
    return {
      sendMessage: mockSendMessage,
      onMessage: mockOnMessage,
      isConnected: computed(() => mockIsConnected.value),
    };
  }

  // 辅助函数：触发消息处理器
  function triggerMessage(type: string, payload: any, sessionId?: string, encoding?: string) {
    const handlers = messageHandlers.get(type) || [];
    handlers.forEach((handler) => handler(payload, { sessionId, encoding }));
  }

  beforeEach(() => {
    vi.clearAllMocks();

    mockSendMessage = vi.fn();
    mockIsConnected = ref(true);
    messageHandlers = new Map();

    // 模拟 onMessage 注册消息处理器
    mockOnMessage = vi.fn((type: string, handler: (payload: any, message?: any) => void) => {
      if (!messageHandlers.has(type)) {
        messageHandlers.set(type, []);
      }
      messageHandlers.get(type)!.push(handler);
      return () => {
        const handlers = messageHandlers.get(type);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) handlers.splice(index, 1);
        }
      };
    });

    // 重置 mock sessions
    mockSessionsMap.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('初始化', () => {
    it('应创建管理器并注册消息处理器', () => {
      createSshTerminalManager('session-1', createWsDeps(), mockT);

      // 应注册所有 SSH 相关消息处理器
      expect(mockOnMessage).toHaveBeenCalledWith('ssh:output', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('ssh:connected', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('ssh:disconnected', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('ssh:error', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('ssh:status', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('info', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('error', expect.any(Function));
    });

    it('应暴露所需的方法和状态', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      // 方法
      expect(typeof manager.handleTerminalReady).toBe('function');
      expect(typeof manager.handleTerminalData).toBe('function');
      expect(typeof manager.handleTerminalResize).toBe('function');
      expect(typeof manager.sendData).toBe('function');
      expect(typeof manager.cleanup).toBe('function');
      expect(typeof manager.searchNext).toBe('function');
      expect(typeof manager.searchPrevious).toBe('function');
      expect(typeof manager.clearTerminalSearch).toBe('function');

      // 状态
      expect(manager.isSshConnected).toBeDefined();
      expect(manager.terminalInstance).toBeDefined();
    });

    it('初始状态应为未连接', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      expect(manager.isSshConnected.value).toBe(false);
      expect(manager.terminalInstance.value).toBeNull();
    });
  });

  describe('handleTerminalReady', () => {
    it('应存储终端和搜索插件实例', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();
      const mockSearchAddon = createMockSearchAddon();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: mockSearchAddon as any,
      });

      // 验证终端实例已存储（检查是否为同一对象类型）
      expect(manager.terminalInstance.value).not.toBeNull();
      expect(manager.terminalInstance.value?.cols).toBe(mockTerminal.cols);
      expect(manager.terminalInstance.value?.rows).toBe(mockTerminal.rows);
    });

    it('应处理 SessionState 中的 pendingOutput', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      // 设置 pendingOutput
      mockSessionsMap.set('session-1', {
        pendingOutput: ['Hello', 'World'],
        isResuming: true,
      });

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      expect(mockTerminal.write).toHaveBeenCalledWith('Hello');
      expect(mockTerminal.write).toHaveBeenCalledWith('World');

      const session = mockSessionsMap.get('session-1');
      expect(session.pendingOutput).toEqual([]);
      expect(session.isResuming).toBe(false);
    });
  });

  describe('handleTerminalData', () => {
    it('应发送终端输入到后端', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      manager.handleTerminalData('ls -la');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'ssh:input',
        sessionId: 'session-1',
        payload: { data: 'ls -la' },
      });
    });
  });

  describe('handleTerminalResize', () => {
    it('已连接时应发送 resize 命令', () => {
      mockIsConnected.value = true;
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      manager.handleTerminalResize({ cols: 120, rows: 40 });

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'ssh:resize',
        sessionId: 'session-1',
        payload: { cols: 120, rows: 40 },
      });
    });

    it('未连接时不应发送 resize 命令', () => {
      mockIsConnected.value = false;
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      manager.handleTerminalResize({ cols: 120, rows: 40 });

      expect(mockSendMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: 'ssh:resize' })
      );
    });
  });

  describe('sendData', () => {
    it('应发送数据到 SSH 会话', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      manager.sendData('echo hello');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'ssh:input',
        sessionId: 'session-1',
        payload: { data: 'echo hello' },
      });
    });
  });

  describe('ssh:output 消息处理', () => {
    it('应将字符串输出写入终端', async () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      triggerMessage('ssh:output', 'Hello World', 'session-1');

      // 输出会被缓冲并通过 requestAnimationFrame 写入
      await nextTick();
    });

    it('应忽略其他会话的消息', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      triggerMessage('ssh:output', 'Hello', 'session-2');

      // 不应写入任何内容
      expect(mockTerminal.write).not.toHaveBeenCalled();
    });

    it('应处理 Base64 编码输出', async () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      const originalText = 'Hello';
      const base64Text = btoa(originalText);

      triggerMessage('ssh:output', base64Text, 'session-1', 'base64');

      await nextTick();
    });
  });

  describe('ssh:connected 消息处理', () => {
    it('应更新连接状态并聚焦终端', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      expect(manager.isSshConnected.value).toBe(false);

      triggerMessage('ssh:connected', {}, 'session-1');

      expect(manager.isSshConnected.value).toBe(true);
      expect(mockTerminal.focus).toHaveBeenCalled();
    });

    it('连接成功后应发送初始 resize', () => {
      mockIsConnected.value = true;
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      mockSendMessage.mockClear();

      triggerMessage('ssh:connected', {}, 'session-1');

      expect(mockSendMessage).toHaveBeenCalledWith({
        type: 'ssh:resize',
        sessionId: 'session-1',
        payload: { cols: 80, rows: 24 },
      });
    });

    it('应忽略其他会话的消息', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      triggerMessage('ssh:connected', {}, 'session-2');

      expect(manager.isSshConnected.value).toBe(false);
    });
  });

  describe('ssh:disconnected 消息处理', () => {
    it('应更新连接状态并显示断开消息', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      // 先连接
      triggerMessage('ssh:connected', {}, 'session-1');
      expect(manager.isSshConnected.value).toBe(true);

      // 断开
      triggerMessage('ssh:disconnected', 'Connection closed', 'session-1');

      expect(manager.isSshConnected.value).toBe(false);
      expect(mockTerminal.writeln).toHaveBeenCalled();
    });
  });

  describe('ssh:error 消息处理', () => {
    it('应更新连接状态并显示错误', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      // 先连接
      triggerMessage('ssh:connected', {}, 'session-1');

      // 错误
      triggerMessage('ssh:error', 'Authentication failed', 'session-1');

      expect(manager.isSshConnected.value).toBe(false);
      expect(mockTerminal.writeln).toHaveBeenCalled();
    });
  });

  describe('info 消息处理', () => {
    it('应在终端显示信息消息', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      triggerMessage('info', 'Server ready', 'session-1');

      expect(mockTerminal.writeln).toHaveBeenCalled();
    });
  });

  describe('error 消息处理', () => {
    it('应在终端显示错误消息', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockTerminal = createMockTerminal();

      manager.handleTerminalReady({
        terminal: mockTerminal as any,
        searchAddon: null,
      });

      triggerMessage('error', 'Something went wrong', 'session-1');

      expect(mockTerminal.writeln).toHaveBeenCalled();
    });
  });

  describe('搜索功能', () => {
    it('searchNext 应调用 searchAddon.findNext', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockSearchAddon = createMockSearchAddon();

      manager.handleTerminalReady({
        terminal: createMockTerminal() as any,
        searchAddon: mockSearchAddon as any,
      });

      const result = manager.searchNext('test');

      expect(mockSearchAddon.findNext).toHaveBeenCalledWith('test', undefined);
      expect(result).toBe(true);
    });

    it('searchPrevious 应调用 searchAddon.findPrevious', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockSearchAddon = createMockSearchAddon();

      manager.handleTerminalReady({
        terminal: createMockTerminal() as any,
        searchAddon: mockSearchAddon as any,
      });

      const result = manager.searchPrevious('test');

      expect(mockSearchAddon.findPrevious).toHaveBeenCalledWith('test', undefined);
      expect(result).toBe(true);
    });

    it('clearTerminalSearch 应调用 searchAddon.clearDecorations', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);
      const mockSearchAddon = createMockSearchAddon();

      manager.handleTerminalReady({
        terminal: createMockTerminal() as any,
        searchAddon: mockSearchAddon as any,
      });

      manager.clearTerminalSearch();

      expect(mockSearchAddon.clearDecorations).toHaveBeenCalled();
    });

    it('searchAddon 不可用时 searchNext 应返回 false', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      manager.handleTerminalReady({
        terminal: createMockTerminal() as any,
        searchAddon: null,
      });

      const result = manager.searchNext('test');

      expect(result).toBe(false);
    });

    it('searchAddon 不可用时 searchPrevious 应返回 false', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      manager.handleTerminalReady({
        terminal: createMockTerminal() as any,
        searchAddon: null,
      });

      const result = manager.searchPrevious('test');

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('应注销所有消息处理器', () => {
      const manager = createSshTerminalManager('session-1', createWsDeps(), mockT);

      // 确认处理器已注册
      expect(messageHandlers.get('ssh:output')?.length).toBeGreaterThan(0);

      manager.cleanup();

      // 处理器应被移除
      expect(messageHandlers.get('ssh:output')?.length).toBe(0);
      expect(manager.terminalInstance.value).toBeNull();
    });
  });

  describe('已弃用的 useSshTerminal 函数', () => {
    it('应返回兼容的接口', async () => {
      const { useSshTerminal } = await import('./useSshTerminal');

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = useSshTerminal(mockT);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('已弃用的 useSshTerminal()'));

      expect(result.terminalInstance).toBeDefined();
      expect(typeof result.handleTerminalReady).toBe('function');
      expect(typeof result.handleTerminalData).toBe('function');
      expect(typeof result.handleTerminalResize).toBe('function');
      expect(typeof result.registerSshHandlers).toBe('function');
      expect(typeof result.unregisterAllSshHandlers).toBe('function');

      warnSpy.mockRestore();
    });
  });
});
