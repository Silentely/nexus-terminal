import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { initializeConnectionHandler } from './connection';
import { AuthenticatedWebSocket } from './types';
import {
  handleSshExecSilent,
  handleSshInput,
  handleSshResize,
  handleSshConnect,
} from './handlers/ssh.handler';
import { registerUserSocket, clientStates, transportChannels } from './state';

vi.mock('./handlers/ssh.handler', () => ({
  handleSshConnect: vi.fn(),
  handleSshInput: vi.fn(),
  handleSshResize: vi.fn(),
  handleSshResumeSuccess: vi.fn(),
  handleSshExecSilent: vi.fn(),
}));

vi.mock('./handlers/docker.handler', () => ({
  handleDockerGetStatus: vi.fn(),
  handleDockerCommand: vi.fn(),
  handleDockerGetStats: vi.fn(),
}));

vi.mock('./handlers/sftp.handler', () => ({
  handleSftpOperation: vi.fn(),
  handleSftpUploadStart: vi.fn(),
  handleSftpUploadChunk: vi.fn(),
  handleSftpUploadCancel: vi.fn(),
}));

vi.mock('./handlers/remote-desktop.handler', () => ({
  handleRdpProxyConnection: vi.fn(),
}));

vi.mock('./state', () => ({
  clientStates: new Map(),
  registerUserSocket: vi.fn(),
  unregisterUserSocket: vi.fn(),
  transportChannels: new Map(),
}));

vi.mock('./heartbeat', () => ({
  resetHeartbeat: vi.fn(),
  cleanupHeartbeat: vi.fn(),
}));

vi.mock('./utils', () => ({
  cleanupClientConnection: vi.fn(),
}));

vi.mock('../ssh-suspend/temporary-log-storage.service', () => ({
  temporaryLogStorageService: {
    ensureLogDirectoryExists: vi.fn().mockResolvedValue(undefined),
    writeToLog: vi.fn().mockResolvedValue(undefined),
    deleteLog: vi.fn().mockResolvedValue(undefined),
  },
}));

const mockIsMultiplexEnabled = vi.fn(() => false);
vi.mock('./multiplex', () => ({
  isMultiplexEnabled: () => mockIsMultiplexEnabled(),
  createMultiplexTransport: vi.fn(() => ({
    channels: new Map(),
    createChannel: vi.fn(),
    removeChannel: vi.fn(),
    sendToChannel: vi.fn(),
    broadcast: vi.fn(),
    getChannelCount: vi.fn(() => 0),
    hasChannel: vi.fn(),
    cleanup: vi.fn(),
  })),
  registerTransport: vi.fn(),
  unregisterTransport: vi.fn(),
  getTransport: vi.fn(),
}));

class MockWebSocketServer extends EventEmitter {
  clients = new Set<WebSocket>();
}

function createMockWebSocket(
  overrides: Partial<AuthenticatedWebSocket> = {},
): AuthenticatedWebSocket {
  const ws = new EventEmitter() as AuthenticatedWebSocket;
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.userId = 7;
  ws.username = 'tester';
  Object.assign(ws, overrides);
  return ws;
}

describe('WebSocket Connection Handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (clientStates as Map<string, any>).clear();
  });

  it('应将 ssh:exec_silent 消息分发到 handleSshExecSilent 并透传 requestId', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket();
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      isRdpProxy: false,
      clientIpAddress: '127.0.0.1',
    } as any;

    wss.emit('connection', ws, request);
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'ssh:exec_silent',
          requestId: 'req-ssh-silent-1',
          payload: { command: 'pwd', timeoutMs: 5000 },
        }),
      ),
    );
    await Promise.resolve();

    expect(registerUserSocket).toHaveBeenCalledWith(7, ws);
    expect(handleSshExecSilent).toHaveBeenCalledWith(
      ws,
      { command: 'pwd', timeoutMs: 5000 },
      'req-ssh-silent-1',
      undefined,
    );
  });

  it('消息校验失败时应返回 error 且不分发到 handler', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket();
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      isRdpProxy: false,
      clientIpAddress: '127.0.0.1',
    } as any;

    wss.emit('connection', ws, request);
    ws.emit('message', Buffer.from(JSON.stringify({ type: 'ssh:exec_silent', payload: {} })));
    await Promise.resolve();

    expect(handleSshExecSilent).not.toHaveBeenCalled();
    const rawMessage = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0];
    const parsedMessage = JSON.parse(rawMessage);
    expect(parsedMessage.type).toBe('error');
    expect(parsedMessage.payload).toContain(
      'payload.command 或 payload.commandsByShell 至少提供一个',
    );
  });

  it('SSH_MARK_FOR_SUSPEND 在请求 SID 过期时应优先使用当前 ws.sessionId', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket({ sessionId: 'sid-active-1' });
    (clientStates as Map<string, any>).set('sid-active-1', {
      sshClient: {},
      sshShellStream: {},
      isMarkedForSuspend: false,
    });
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      isRdpProxy: false,
      clientIpAddress: '127.0.0.1',
    } as any;

    wss.emit('connection', ws, request);
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'SSH_MARK_FOR_SUSPEND',
          payload: { sessionId: 'sid-stale-1' },
        }),
      ),
    );
    await Promise.resolve();

    const rawMessage = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0];
    const parsedMessage = JSON.parse(rawMessage);
    expect(parsedMessage.type).toBe('SSH_MARKED_FOR_SUSPEND_ACK');
    expect(parsedMessage.payload.success).toBe(true);
    expect(parsedMessage.payload.sessionId).toBe('sid-active-1');
    expect((clientStates as Map<string, any>).get('sid-active-1')?.isMarkedForSuspend).toBe(true);
  });

  it('SSH_UNMARK_FOR_SUSPEND 在请求 SID 过期时应优先使用当前 ws.sessionId', async () => {
    const wss = new MockWebSocketServer();
    const sshSuspendService = { on: vi.fn() } as any;
    const sftpService = {} as any;
    initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

    const ws = createMockWebSocket({ sessionId: 'sid-active-2' });
    (clientStates as Map<string, any>).set('sid-active-2', {
      sshClient: {},
      sshShellStream: {},
      isMarkedForSuspend: true,
      suspendLogPath: undefined,
    });
    const request = {
      headers: { 'user-agent': 'Mozilla/5.0' },
      isRdpProxy: false,
      clientIpAddress: '127.0.0.1',
    } as any;

    wss.emit('connection', ws, request);
    ws.emit(
      'message',
      Buffer.from(
        JSON.stringify({
          type: 'SSH_UNMARK_FOR_SUSPEND',
          payload: { sessionId: 'sid-stale-2' },
        }),
      ),
    );
    await Promise.resolve();

    const rawMessage = (ws.send as any).mock.calls[(ws.send as any).mock.calls.length - 1][0];
    const parsedMessage = JSON.parse(rawMessage);
    expect(parsedMessage.type).toBe('SSH_UNMARKED_FOR_SUSPEND_ACK');
    expect(parsedMessage.payload.success).toBe(true);
    expect(parsedMessage.payload.sessionId).toBe('sid-active-2');
    expect((clientStates as Map<string, any>).get('sid-active-2')?.isMarkedForSuspend).toBe(false);
  });

  describe('多路复用路由', () => {
    beforeEach(() => {
      mockIsMultiplexEnabled.mockReturnValue(true);
    });

    afterEach(() => {
      mockIsMultiplexEnabled.mockReturnValue(false);
    });

    it('多路复用模式下 ssh:input 应使用消息中的 sid 路由', async () => {
      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ sessionId: 'ws-session', isMultiplex: true } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      // 注册目标会话到 clientStates 和 transportChannels
      (clientStates as Map<string, any>).set('target-session', {
        ws,
        sshShellStream: { write: vi.fn() },
        isShellReady: true,
      });
      const channels = new Set<string>();
      channels.add('target-session');
      (transportChannels as Map<any, any>).set(ws, channels);

      wss.emit('connection', ws, request);
      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ type: 'ssh:input', sid: 'target-session', payload: 'ls\n' })),
      );
      await Promise.resolve();

      expect(handleSshInput).toHaveBeenCalledWith(ws, 'ls\n', 'target-session');
    });

    it('多路复用模式下 ssh:resize 应使用消息中的 sid 路由', async () => {
      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ sessionId: 'ws-session', isMultiplex: true } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      (clientStates as Map<string, any>).set('target-session', {
        ws,
        sshClient: {},
        sshShellStream: { setWindow: vi.fn() },
        isShellReady: true,
      });
      const channels2 = new Set<string>();
      channels2.add('target-session');
      (transportChannels as Map<any, any>).set(ws, channels2);

      wss.emit('connection', ws, request);
      ws.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'ssh:resize',
            sid: 'target-session',
            payload: { cols: 120, rows: 40 },
          }),
        ),
      );
      await Promise.resolve();

      expect(handleSshResize).toHaveBeenCalledWith(ws, { cols: 120, rows: 40 }, 'target-session');
    });

    it('非多路复用模式下 ssh:input 应使用 ws.sessionId', async () => {
      mockIsMultiplexEnabled.mockReturnValue(false);

      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ sessionId: 'ws-session' } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      wss.emit('connection', ws, request);
      ws.emit('message', Buffer.from(JSON.stringify({ type: 'ssh:input', payload: 'ls\n' })));
      await Promise.resolve();

      expect(handleSshInput).toHaveBeenCalledWith(ws, 'ls\n', 'ws-session');
    });

    it('多路复用模式下不存在的 sid 应被拒绝', async () => {
      mockIsMultiplexEnabled.mockReturnValue(true);
      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ sessionId: 'ws-session', isMultiplex: true } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      wss.emit('connection', ws, request);
      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ type: 'ssh:input', sid: 'non-existent', payload: 'ls\n' })),
      );
      await Promise.resolve();

      expect(handleSshInput).not.toHaveBeenCalled();
      const sendCalls = (ws.send as any).mock.calls;
      const lastMsg = JSON.parse(sendCalls[sendCalls.length - 1][0]);
      expect(lastMsg.type).toBe('error');
      expect(lastMsg.payload).toBe('会话不存在');
    });

    it('多路复用模式下不属于当前物理连接的 sid 应被拒绝', async () => {
      mockIsMultiplexEnabled.mockReturnValue(true);
      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ sessionId: 'ws-session', isMultiplex: true } as any);
      const otherWs = createMockWebSocket({ sessionId: 'other-session', userId: 7 } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      // 注册目标会话到 clientStates（属于 otherWs，不是 ws）
      (clientStates as Map<string, any>).set('other-session', {
        ws: otherWs,
        sshShellStream: { write: vi.fn() },
        isShellReady: true,
      });
      // 注册通道到 otherWs，不注册到 ws
      const otherChannels = new Set<string>();
      otherChannels.add('other-session');
      (transportChannels as Map<any, any>).set(otherWs, otherChannels);

      wss.emit('connection', ws, request);
      ws.emit(
        'message',
        Buffer.from(JSON.stringify({ type: 'ssh:input', sid: 'other-session', payload: 'ls\n' })),
      );
      await Promise.resolve();

      expect(handleSshInput).not.toHaveBeenCalled();
      const sendCalls = (ws.send as any).mock.calls;
      const lastMsg = JSON.parse(sendCalls[sendCalls.length - 1][0]);
      expect(lastMsg.type).toBe('error');
      expect(lastMsg.payload).toBe('该会话不属于当前连接');
    });

    it('多路复用模式下跨用户 sid 应被拒绝', async () => {
      mockIsMultiplexEnabled.mockReturnValue(true);
      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ sessionId: 'ws-session', isMultiplex: true } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      // 注册目标会话到 clientStates（属于不同用户）
      (clientStates as Map<string, any>).set('other-user-session', {
        ws: { userId: 999, sessionId: 'other-user-session' },
        sshShellStream: { write: vi.fn() },
        isShellReady: true,
      });

      wss.emit('connection', ws, request);
      ws.emit(
        'message',
        Buffer.from(
          JSON.stringify({ type: 'ssh:input', sid: 'other-user-session', payload: 'ls\n' }),
        ),
      );
      await Promise.resolve();

      expect(handleSshInput).not.toHaveBeenCalled();
      const sendCalls = (ws.send as any).mock.calls;
      const lastMsg = JSON.parse(sendCalls[sendCalls.length - 1][0]);
      expect(lastMsg.type).toBe('error');
      expect(lastMsg.payload).toBe('无权访问该会话');
    });

    it('多路复用模式下 ssh:connect 应跳过 clientStates 校验并调用 handleSshConnect', async () => {
      const wss = new MockWebSocketServer();
      const sshSuspendService = { on: vi.fn() } as any;
      const sftpService = {} as any;
      initializeConnectionHandler(wss as any, sshSuspendService, sftpService);

      const ws = createMockWebSocket({ isMultiplex: true } as any);
      const request = {
        headers: { 'user-agent': 'Mozilla/5.0' },
        isRdpProxy: false,
        clientIpAddress: '127.0.0.1',
      } as any;

      wss.emit('connection', ws, request);
      ws.emit(
        'message',
        Buffer.from(
          JSON.stringify({
            type: 'ssh:connect',
            sid: 'frontend-temp-sid',
            payload: { connectionId: 1 },
          }),
        ),
      );
      await Promise.resolve();

      // ssh:connect 应被分发到 handleSshConnect，不应返回"会话不存在"
      expect(handleSshConnect).toHaveBeenCalledWith(
        ws,
        request,
        { connectionId: 1 },
        'frontend-temp-sid',
      );
      // 不应发送"会话不存在"错误
      const sendCalls = (ws.send as any).mock.calls;
      const hasSessionNotFound = sendCalls.some((call: unknown[]) => {
        try {
          const msg = JSON.parse(call[0]);
          return msg.payload === '会话不存在';
        } catch {
          return false;
        }
      });
      expect(hasSessionNotFound).toBe(false);
    });
  });
});
