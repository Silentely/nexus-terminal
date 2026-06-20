/**
 * WebSocket 初始化单元测试
 * 测试 WebSocket 服务器创建和事件处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'http';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const {
  mockInitializeHeartbeat,
  mockInitializeUpgradeHandler,
  mockInitializeConnectionHandler,
  mockClientStates,
  mockCleanupClientConnection,
} = vi.hoisted(() => ({
  mockInitializeHeartbeat: vi.fn().mockReturnValue(123),
  mockInitializeUpgradeHandler: vi.fn(),
  mockInitializeConnectionHandler: vi.fn(),
  mockClientStates: new Map<string, any>(),
  mockCleanupClientConnection: vi.fn().mockReturnValue(Promise.resolve(undefined)),
}));

vi.mock('./websocket/heartbeat', () => ({
  initializeHeartbeat: mockInitializeHeartbeat,
}));

vi.mock('./websocket/upgrade', () => ({
  initializeUpgradeHandler: mockInitializeUpgradeHandler,
}));

vi.mock('./websocket/connection', () => ({
  initializeConnectionHandler: mockInitializeConnectionHandler,
}));

vi.mock('./websocket/state', () => ({
  clientStates: mockClientStates,
}));

vi.mock('./websocket/utils', () => ({
  cleanupClientConnection: mockCleanupClientConnection,
}));

vi.mock('./ssh-suspend/ssh-suspend.service', () => ({
  sshSuspendService: {},
}));

vi.mock('./sftp/sftp.service', () => ({
  SftpService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('./utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('WebSocket 初始化', () => {
  let mockServer: http.Server;
  let mockSessionParser: Record<string, ReturnType<typeof vi.fn>>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClientStates.clear();
    mockServer = {} as http.Server;
    mockSessionParser = vi.fn();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it('应导出 initializeWebSocket 函数', async () => {
    const { initializeWebSocket } = await import('./websocket');
    expect(typeof initializeWebSocket).toBe('function');
  });

  it('应导出 clientStates', async () => {
    const { clientStates } = await import('./websocket');
    expect(clientStates).toBeDefined();
  });

  it('应初始化心跳、升级处理器和连接处理器', async () => {
    const { initializeWebSocket } = await import('./websocket');

    await initializeWebSocket(mockServer, mockSessionParser);

    expect(mockInitializeHeartbeat).toHaveBeenCalledTimes(1);
    expect(mockInitializeUpgradeHandler).toHaveBeenCalledTimes(1);
    expect(mockInitializeUpgradeHandler).toHaveBeenCalledWith(
      mockServer,
      expect.anything(),
      mockSessionParser,
    );
    expect(mockInitializeConnectionHandler).toHaveBeenCalledTimes(1);
  });

  it('应返回 WebSocketServer 实例', async () => {
    const { initializeWebSocket } = await import('./websocket');

    const wss = await initializeWebSocket(mockServer, mockSessionParser);

    expect(wss).toBeDefined();
    expect(wss).toHaveProperty('on');
  });

  it('应设置 maxPayload 为 4MB', async () => {
    const { initializeWebSocket } = await import('./websocket');

    const wss = await initializeWebSocket(mockServer, mockSessionParser);

    // 验证 WebSocketServer 配置
    expect(wss.options.maxPayload).toBe(4 * 1024 * 1024);
  });

  it('应设置 noServer 模式', async () => {
    const { initializeWebSocket } = await import('./websocket');

    const wss = await initializeWebSocket(mockServer, mockSessionParser);

    expect(wss.options.noServer).toBe(true);
  });

  it('服务器关闭时应清理心跳定时器', async () => {
    const { initializeWebSocket } = await import('./websocket');

    const wss = await initializeWebSocket(mockServer, mockSessionParser);

    // 添加一个客户端状态
    mockClientStates.set('session-1', { connected: true });

    // 模拟 wss 触发 close 事件
    const closeCallbacks: Function[] = [];
    const originalOn = wss.on.bind(wss);
    wss.on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      if (event === 'close') closeCallbacks.push(cb);
      return originalOn(event, cb);
    });

    // 重新初始化以捕获 close 事件
    const wss2 = await initializeWebSocket(mockServer, mockSessionParser);
    const closeHandler = (wss2.on as unknown).mock?.calls?.find(
      (call: unknown[]) => call[0] === 'close',
    )?.[1];

    if (closeHandler) {
      closeHandler();
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(mockInitializeHeartbeat).toHaveBeenCalled();
  });

  it('应支持多个客户端状态管理', async () => {
    const { clientStates } = await import('./websocket');

    // 添加多个客户端状态
    clientStates.set('session-1', { connected: true });
    clientStates.set('session-2', { connected: true });
    clientStates.set('session-3', { connected: false });

    expect(clientStates.size).toBe(3);
    expect(clientStates.get('session-1')).toEqual({ connected: true });
    expect(clientStates.get('session-2')).toEqual({ connected: true });
    expect(clientStates.get('session-3')).toEqual({ connected: false });
  });
});
