/**
 * SSH WebSocket Handler 单元测试
 * 测试 SSH 连接管理的 WebSocket 消息处理逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import {
  handleSshConnect,
  handleSshExecSilent,
  handleSshInput,
  handleSshResize,
  handleSshResumeSuccess,
} from './ssh.handler';
import { AuthenticatedWebSocket, ClientState } from '../types';
import { clientStates } from '../state';
import * as SshService from '../../services/ssh.service';

// Mock crypto.randomUUID
vi.mock('crypto', () => ({
  default: {
    randomUUID: vi.fn(() => 'mock-session-id-12345'),
  },
  randomUUID: vi.fn(() => 'mock-session-id-12345'),
}));

// Mock SSH Service
vi.mock('../../services/ssh.service', () => ({
  getConnectionDetails: vi.fn(),
  establishSshConnection: vi.fn(),
}));

// Mock state module services
vi.mock('../state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../state')>();
  return {
    ...original,
    clientStates: new Map<string, ClientState>(),
    sftpService: {
      initializeSftpSession: vi.fn().mockResolvedValue(undefined),
    },
    statusMonitorService: {
      startStatusPolling: vi.fn(),
    },
    auditLogService: {
      logAction: vi.fn(),
    },
    notificationService: {
      sendNotification: vi.fn(),
    },
  };
});

// Mock utils
vi.mock('../utils', () => ({
  cleanupClientConnection: vi.fn().mockResolvedValue(undefined),
  registerSessionCleanup: vi.fn(),
  sendWsMessage: vi.fn(
    (
      ws: { readyState: number; send: (data: string) => void },
      type: string,
      payload: Record<string, unknown>,
      sessionId?: string,
    ) => {
      if (ws.readyState === 1) {
        const message: Record<string, unknown> = { type, payload };
        if (sessionId) message.sid = sessionId;
        ws.send(JSON.stringify(message));
      }
    },
  ),
  safeSend: vi.fn(
    (
      ws: { readyState: number; send: (data: string) => void },
      type: string,
      payload: Record<string, unknown>,
      sessionId?: string,
    ): boolean => {
      if (ws.readyState !== 1) {
        return false;
      }
      try {
        const message: Record<string, unknown> = { type, payload };
        if (sessionId) message.sid = sessionId;
        ws.send(JSON.stringify(message));
        return true;
      } catch {
        return false;
      }
    },
  ),
}));

// Mock temporaryLogStorageService
vi.mock('../../ssh-suspend/temporary-log-storage.service', () => ({
  temporaryLogStorageService: {
    writeToLog: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock docker handler
vi.mock('./docker.handler', () => ({
  startDockerStatusPolling: vi.fn(),
}));

// Mock output-batcher: 同步发送，避免 16ms 定时器导致测试中的时序问题
vi.mock('../output-batcher', () => {
  return {
    getOrCreateBatcher: vi.fn(
      (_ws: unknown, _sessionId: string, onSend?: (data: string) => void) => {
        return {
          write: (data: string) => {
            if (onSend) onSend(Buffer.from(data, 'utf8').toString('base64'));
          },
          flush: vi.fn(),
          destroy: vi.fn(),
          getBufferLength: () => 0,
        };
      },
    ),
    destroyBatcher: vi.fn(),
    flushBatcher: vi.fn(),
    cleanupAllBatchers: vi.fn(),
  };
});

// Mock SSH Client
class MockSshClient extends EventEmitter {
  end = vi.fn();
  shell = vi.fn();
  exec = vi.fn();
}

// Mock Shell Stream
class MockShellStream extends EventEmitter {
  write = vi.fn();
  setWindow = vi.fn();
  stderr = new EventEmitter();
}

// Helper to create mock WebSocket
function createMockWebSocket(
  overrides: Partial<AuthenticatedWebSocket> = {},
): AuthenticatedWebSocket {
  const ws = new EventEmitter() as AuthenticatedWebSocket;
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.userId = 1;
  ws.username = 'testuser';
  ws.sessionId = undefined;
  Object.assign(ws, overrides);
  return ws;
}

// Helper to create mock Request
function createMockRequest(clientIp: string = '127.0.0.1'): unknown {
  return {
    clientIpAddress: clientIp,
  };
}

describe('SSH WebSocket Handler', () => {
  let mockWs: AuthenticatedWebSocket;
  let mockRequest: unknown;
  let mockSshClient: MockSshClient;
  let mockShellStream: MockShellStream;

  beforeEach(() => {
    vi.clearAllMocks();
    clientStates.clear();

    mockWs = createMockWebSocket();
    mockRequest = createMockRequest();
    mockSshClient = new MockSshClient();
    mockShellStream = new MockShellStream();
  });

  afterEach(() => {
    clientStates.clear();
  });

  describe('handleSshConnect', () => {
    const mockConnectionDetails: SshService.DecryptedConnectionDetails = {
      id: 1,
      name: '测试服务器',
      host: '192.168.1.1',
      port: 22,
      username: 'testuser',
      auth_method: 'password',
      password: 'testpass',
      proxy: null,
      connection_proxy_setting: null,
    };

    it('缺少 connectionId 时应发送错误消息', async () => {
      await handleSshConnect(mockWs, mockRequest, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:error', payload: '缺少 connectionId。' }),
      );
    });

    it('已有活动连接时应忽略新的连接请求', async () => {
      // 设置已有会话
      mockWs.sessionId = 'existing-session';
      const existingState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        dbConnectionId: 1,
        connectionName: '现有连接',
        isShellReady: true,
      };
      clientStates.set('existing-session', existingState);

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'ssh:error',
          payload: '已存在活动的 SSH 连接。',
          sid: 'existing-session',
        }),
      );
      expect(SshService.getConnectionDetails).not.toHaveBeenCalled();
    });

    it('应成功建立 SSH 连接并打开 Shell', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      // 模拟 shell 成功打开
      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      const connectPromise = handleSshConnect(mockWs, mockRequest, {
        connectionId: 1,
        cols: 120,
        rows: 40,
        term: 'xterm-256color',
      });

      await connectPromise;

      // 验证状态消息
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:status', payload: '正在处理连接请求...' }),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:status', payload: '正在获取连接信息...' }),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:status', payload: '正在连接到 192.168.1.1...' }),
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'ssh:status',
          payload: 'SSH 连接成功，正在打开 Shell...',
          sid: 'mock-session-id-12345',
        }),
      );

      // 验证 shell 调用参数
      expect(mockSshClient.shell).toHaveBeenCalledWith(
        { term: 'xterm-256color', cols: 120, rows: 40 },
        expect.any(Function),
      );

      // 验证连接成功消息
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ssh:connected"'));

      // 验证 sessionId 被设置
      expect(mockWs.sessionId).toBe('mock-session-id-12345');

      // 验证状态被保存
      expect(clientStates.has('mock-session-id-12345')).toBe(true);
      const state = clientStates.get('mock-session-id-12345');
      expect(state?.dbConnectionId).toBe(1);
      expect(state?.connectionName).toBe('测试服务器');
      expect(state?.isShellReady).toBe(true);
    });

    it('使用默认终端参数', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 验证使用默认参数
      expect(mockSshClient.shell).toHaveBeenCalledWith(
        { term: 'xterm-256color', cols: 80, rows: 24 },
        expect.any(Function),
      );
    });

    it('无效的 connectionId 应发送错误并关闭', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      await handleSshConnect(mockWs, mockRequest, { connectionId: 'invalid' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:error', payload: '无效的连接 ID。' }),
      );
      expect(mockWs.close).toHaveBeenCalledWith(1008, 'Invalid Connection ID');
    });

    it('Shell 打开失败时应清理连接', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(new Error('Shell 打开失败'));
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'ssh:error',
          payload: '打开 Shell 失败: Shell 打开失败',
          sid: 'mock-session-id-12345',
        }),
      );
    });

    it('Shell 回调未响应时应超时并发送错误消息', async () => {
      vi.useFakeTimers();
      try {
        (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
        (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

        // 模拟 shell 回调永不触发
        mockSshClient.shell.mockImplementation((_opts: unknown, _callback: unknown) => {
          // 不调用回调，模拟 shell 挂起
        });

        void handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

        // 推进时间到超时 (SHELL_READY_TIMEOUT_MS = 10_000)
        vi.advanceTimersByTime(10_000);

        // 等待异步清理完成
        await vi.runOnlyPendingTimersAsync();

        // 验证发送了超时错误消息
        const sendCalls = (mockWs.send as any).mock.calls;
        const errorCall = sendCalls.find((call: unknown[]) => {
          try {
            const parsed = JSON.parse(call[0] as string);
            return parsed.type === 'ssh:error' && parsed.payload.includes('Shell 就绪超时');
          } catch {
            return false;
          }
        });
        expect(errorCall).toBeTruthy();
      } finally {
        vi.useRealTimers();
      }
    });

    it('SSH 连接失败时应发送错误', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockRejectedValue(new Error('Connection refused'));

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:error', payload: '连接失败: Connection refused' }),
      );
      expect(mockWs.close).toHaveBeenCalledWith(1011, 'SSH Connection Failed: Connection refused');
    });

    it('获取连接详情失败时应发送错误', async () => {
      (SshService.getConnectionDetails as any).mockRejectedValue(new Error('连接配置未找到'));

      await handleSshConnect(mockWs, mockRequest, { connectionId: 999 });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({ type: 'ssh:error', payload: '连接失败: 连接配置未找到' }),
      );
    });

    it('WebSocket 关闭时不应发送消息', async () => {
      mockWs.readyState = WebSocket.CLOSED;

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // send 不应被调用（除了可能的初始状态检查）
      const sendCalls = (mockWs.send as any).mock.calls;
      expect(sendCalls.length).toBe(0);
    });

    it('应正确处理 Shell 数据输出', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 模拟 Shell 输出数据
      const testData = Buffer.from('Hello, World!');
      mockShellStream.emit('data', testData);

      // 验证数据以 Base64 编码发送
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ssh:output"'));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"encoding":"base64"'));
    });

    it('应正确处理 Shell stderr 输出', async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 模拟 stderr 输出
      const errorData = Buffer.from('Error message');
      mockShellStream.stderr.emit('data', errorData);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('"type":"ssh:output"'));
    });

    it('Shell 关闭时应清理连接', async () => {
      const { cleanupClientConnection } = await import('../utils');

      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 模拟 Shell 关闭
      mockShellStream.emit('close');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'ssh:disconnected',
          payload: 'Shell 通道已关闭。',
          sid: 'mock-session-id-12345',
        }),
      );
      expect(cleanupClientConnection).toHaveBeenCalledWith('mock-session-id-12345');
    });
  });

  describe('handleSshExecSilent', () => {
    const mockConnectionDetails: SshService.DecryptedConnectionDetails = {
      id: 1,
      name: '测试服务器',
      host: '192.168.1.1',
      port: 22,
      username: 'testuser',
      auth_method: 'password',
      password: 'testpass',
      proxy: null,
      connection_proxy_setting: null,
    };

    const getLastSentMessage = () => {
      const calls = (mockWs.send as any).mock.calls;
      const raw = calls[calls.length - 1]?.[0];
      return raw ? JSON.parse(raw) : null;
    };

    const connectReadyShellSession = async () => {
      (SshService.getConnectionDetails as any).mockResolvedValue(mockConnectionDetails);
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);
      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });
      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });
      (mockWs.send as any).mockClear();
    };

    const extractMarkers = (writtenCommand: string) => {
      const lines = writtenCommand
        .split('\n')
        .map((line) => {
          let normalizedLine = line;
          while (normalizedLine.charCodeAt(0) === 21) {
            normalizedLine = normalizedLine.slice(1);
          }
          return normalizedLine.trim();
        })
        .filter(Boolean);
      const startLine = lines.find((line) => line.includes('__NX_SILENT_START_')) || '';
      const endLine = lines.find((line) => line.includes('__NX_SILENT_END_')) || '';
      return {
        startMarker: startLine.replace(/^echo\s+/, '').trim(),
        endMarker: endLine.replace(/^echo\s+/, '').trim(),
      };
    };

    it('应在命令执行成功时返回结果', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(mockWs, { command: 'pwd' }, 'req-silent-1');
      expect(mockShellStream.write).toHaveBeenCalledTimes(1);

      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`echo ${startMarker}\n`));
      mockShellStream.emit('data', Buffer.from(`${startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('pwd\n/home/test\n'));
      mockShellStream.emit('data', Buffer.from(`${endMarker}\n`));

      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-1');
      expect(message.payload.output).toContain('/home/test');

      const outputMessages = (mockWs.send as any).mock.calls
        .map((call: unknown[]) => JSON.parse(call[0]))
        .filter((msg: unknown) => msg.type === 'ssh:output');
      expect(outputMessages).toHaveLength(0);
    });

    it('start marker 前存在 shell prompt 时也应正确采集输出并返回结果', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(mockWs, { command: 'pwd' }, 'req-silent-prompt-marker');
      expect(mockShellStream.write).toHaveBeenCalledTimes(1);

      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`root@localhost:/opt$ ${startMarker}\n`));
      mockShellStream.emit(
        'data',
        Buffer.from(
          `root@localhost:/opt$ pwd 2>/dev/null || /bin/pwd 2>/dev/null\n/opt\nroot@localhost:/opt$ echo ${endMarker}\n${endMarker}\n`,
        ),
      );

      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-prompt-marker');
      expect(message.payload.output).toContain('/opt');
    });

    it('执行静默命令前应先清空当前输入行，避免与未回车输入拼接', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        {
          command: "printf '__NX_PWD__%s\\n' '/root'",
          successCriteria: 'absolute_path',
        },
        'req-silent-clear-pending-input',
      );
      expect(mockShellStream.write).toHaveBeenCalledTimes(1);

      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      expect(firstWrite.startsWith('\u0015')).toBe(true);
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from('bash: aptecho: command not found\n'));
      mockShellStream.emit('data', Buffer.from(`${startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('__NX_PWD__/root\n'));
      mockShellStream.emit('data', Buffer.from(`${endMarker}\n`));

      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-clear-pending-input');
      expect(message.payload.output).toContain('__NX_PWD__/root');
    });

    it('结束标记后的无换行 prompt 尾部应继续透传到终端', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(mockWs, { command: 'pwd' }, 'req-silent-1b');
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit(
        'data',
        Buffer.from(`${startMarker}\npwd\n/home/test\n${endMarker}\nuser@host:~$ `),
      );

      const messages = (mockWs.send as any).mock.calls.map((call: unknown[]) =>
        JSON.parse(call[0]),
      );
      const resultMessage = messages.find((msg: unknown) => msg.type === 'ssh:exec_silent:result');
      const outputMessage = messages.find((msg: unknown) => msg.type === 'ssh:output');

      expect(resultMessage.requestId).toBe('req-silent-1b');
      expect(resultMessage.payload.output).toContain('/home/test');
      expect(outputMessage).toBeTruthy();
      expect(Buffer.from(outputMessage.payload, 'base64').toString('utf8')).toBe('user@host:~$ ');
    });

    it('设置 suppressTerminalPrompt 时不应透传静默命令产生的尾部 prompt', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        { command: 'pwd', suppressTerminalPrompt: true },
        'req-silent-no-prompt-echo',
      );
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit(
        'data',
        Buffer.from(`${startMarker}\npwd\n/home/test\n${endMarker}\nuser@host:~$ `),
      );

      const messages = (mockWs.send as any).mock.calls.map((call: unknown[]) =>
        JSON.parse(call[0]),
      );
      const resultMessage = messages.find((msg: unknown) => msg.type === 'ssh:exec_silent:result');
      const outputMessage = messages.find((msg: unknown) => msg.type === 'ssh:output');

      expect(resultMessage.requestId).toBe('req-silent-no-prompt-echo');
      expect(resultMessage.payload.output).toContain('/home/test');
      expect(outputMessage).toBeUndefined();
    });

    it('设置 suppressTerminalPrompt 时应抑制下一数据分片中的尾部 prompt', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        { command: 'pwd', suppressTerminalPrompt: true },
        'req-silent-no-prompt-next-chunk',
      );
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`${startMarker}\npwd\n/home/test\n${endMarker}\n`));
      mockShellStream.emit('data', Buffer.from('user@host:~$ '));

      const messages = (mockWs.send as any).mock.calls.map((call: unknown[]) =>
        JSON.parse(call[0]),
      );
      const resultMessage = messages.find((msg: unknown) => msg.type === 'ssh:exec_silent:result');
      const outputMessages = messages.filter((msg: unknown) => msg.type === 'ssh:output');

      expect(resultMessage.requestId).toBe('req-silent-no-prompt-next-chunk');
      expect(resultMessage.payload.output).toContain('/home/test');
      expect(outputMessages).toHaveLength(0);
    });

    it('设置 suppressTerminalPrompt 时不应吞掉下一分片的非提示符输出', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        { command: 'pwd', suppressTerminalPrompt: true },
        'req-silent-pass-through-next-chunk',
      );
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`${startMarker}\npwd\n/home/test\n${endMarker}\n`));
      mockShellStream.emit('data', Buffer.from('file changed\n'));

      const messages = (mockWs.send as any).mock.calls.map((call: unknown[]) =>
        JSON.parse(call[0]),
      );
      const outputMessage = messages.find((msg: unknown) => msg.type === 'ssh:output');

      expect(outputMessage).toBeTruthy();
      expect(Buffer.from(outputMessage.payload, 'base64').toString('utf8')).toBe('file changed\n');
    });

    it('结束标记后大块无换行输出应完整透传', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(mockWs, { command: 'pwd' }, 'req-silent-1c');
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);
      const tail = 'x'.repeat(20000);

      mockShellStream.emit(
        'data',
        Buffer.from(`${startMarker}\npwd\n/home/test\n${endMarker}\n${tail}`),
      );

      const messages = (mockWs.send as any).mock.calls.map((call: unknown[]) =>
        JSON.parse(call[0]),
      );
      const outputMessage = messages.find((msg: unknown) => msg.type === 'ssh:output');
      expect(outputMessage).toBeTruthy();
      expect(Buffer.from(outputMessage.payload, 'base64').toString('utf8')).toBe(tail);
    });

    it('应在首个命令不返回路径时自动回退后续命令', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        {
          successCriteria: 'absolute_path',
          commandsByShell: {
            posix: 'bad-cmd',
            default: 'pwd',
          },
        },
        'req-silent-2',
      );

      expect(mockShellStream.write).toHaveBeenCalledTimes(1);

      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const firstMarkers = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`${firstMarkers.startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('bad-cmd\ncommand not found\n'));
      mockShellStream.emit('data', Buffer.from(`${firstMarkers.endMarker}\n`));

      expect(mockShellStream.write).toHaveBeenCalledTimes(2);
      const secondWrite = (mockShellStream.write as any).mock.calls[1][0] as string;
      const secondMarkers = extractMarkers(secondWrite);

      mockShellStream.emit('data', Buffer.from(`${secondMarkers.startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('pwd\n/var/www\n'));
      mockShellStream.emit('data', Buffer.from(`${secondMarkers.endMarker}\n`));

      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-2');
      expect(message.payload.output).toContain('/var/www');
    });

    it('默认 non_empty 策略下非路径输出应直接成功，不触发回退', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        {
          commandsByShell: {
            posix: 'echo hello',
            default: 'pwd',
          },
        },
        'req-silent-2b',
      );

      expect(mockShellStream.write).toHaveBeenCalledTimes(1);
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const firstMarkers = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`${firstMarkers.startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('echo hello\nhello\n'));
      mockShellStream.emit('data', Buffer.from(`${firstMarkers.endMarker}\n`));

      expect(mockShellStream.write).toHaveBeenCalledTimes(1);
      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-2b');
      expect(message.payload.output).toContain('hello');
    });

    it('提供 shellFlavorHint 时应优先同壳命令并仅回退 default', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        {
          shellFlavorHint: 'posix',
          successCriteria: 'absolute_path',
          commandsByShell: {
            posix: 'echo not-a-path',
            powershell: '(Get-Location).Path',
            default: 'pwd',
          },
        },
        'req-silent-shell-hint',
      );

      expect(mockShellStream.write).toHaveBeenCalledTimes(1);
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      expect(firstWrite).toContain('echo not-a-path');
      const firstMarkers = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`${firstMarkers.startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('echo not-a-path\nnot-a-path\n'));
      mockShellStream.emit('data', Buffer.from(`${firstMarkers.endMarker}\n`));

      expect(mockShellStream.write).toHaveBeenCalledTimes(2);
      const secondWrite = (mockShellStream.write as any).mock.calls[1][0] as string;
      expect(secondWrite).toContain('pwd');
      expect(secondWrite).not.toContain('(Get-Location).Path');
      const secondMarkers = extractMarkers(secondWrite);

      mockShellStream.emit('data', Buffer.from(`${secondMarkers.startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('pwd\n/var/www\n'));
      mockShellStream.emit('data', Buffer.from(`${secondMarkers.endMarker}\n`));

      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-shell-hint');
      expect(message.payload.output).toContain('/var/www');
    });

    it('absolute_path 策略应识别带 __NX_PWD__ 前缀的路径行', async () => {
      await connectReadyShellSession();

      handleSshExecSilent(
        mockWs,
        {
          command: "printf '__NX_PWD__%s\\n' '/srv/app'",
          successCriteria: 'absolute_path',
        },
        'req-silent-prefixed-path',
      );

      expect(mockShellStream.write).toHaveBeenCalledTimes(1);
      const firstWrite = (mockShellStream.write as any).mock.calls[0][0] as string;
      const { startMarker, endMarker } = extractMarkers(firstWrite);

      mockShellStream.emit('data', Buffer.from(`${startMarker}\n`));
      mockShellStream.emit('data', Buffer.from('__NX_PWD__/srv/app\n'));
      mockShellStream.emit('data', Buffer.from(`${endMarker}\n`));

      const message = getLastSentMessage();
      expect(message.type).toBe('ssh:exec_silent:result');
      expect(message.requestId).toBe('req-silent-prefixed-path');
      expect(message.payload.output).toContain('__NX_PWD__/srv/app');
    });

    it('超时时应返回错误', async () => {
      vi.useFakeTimers();
      try {
        await connectReadyShellSession();

        handleSshExecSilent(mockWs, { command: 'pwd', timeoutMs: 1000 }, 'req-silent-3');
        vi.advanceTimersByTime(1000);
        await vi.runOnlyPendingTimersAsync();

        const message = getLastSentMessage();
        expect(message.type).toBe('ssh:exec_silent:error');
        expect(message.requestId).toBe('req-silent-3');
        expect(message.payload.error).toContain('Timed out');
      } finally {
        vi.useRealTimers();
      }
    });

    it('Shell 未就绪时应返回错误', () => {
      mockWs.sessionId = 'silent-session';
      clientStates.set('silent-session', {
        ws: mockWs,
        sshClient: mockSshClient as any,
        dbConnectionId: 1,
        isShellReady: false,
      });

      handleSshExecSilent(mockWs, { command: 'pwd' }, 'req-silent-4');
      const message = getLastSentMessage();

      expect(message.type).toBe('ssh:exec_silent:error');
      expect(message.requestId).toBe('req-silent-4');
      expect(message.payload.error).toBe('SSH shell is not ready.');
    });
  });

  describe('handleSshInput', () => {
    it('无活动会话时应忽略输入', () => {
      handleSshInput(mockWs, 'test input');

      expect(mockShellStream.write).not.toHaveBeenCalled();
    });

    it('无 Shell Stream 时应忽略输入', () => {
      mockWs.sessionId = 'test-session';
      const stateWithoutShell: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        dbConnectionId: 1,
        isShellReady: false,
      };
      clientStates.set('test-session', stateWithoutShell);

      handleSshInput(mockWs, 'test input');

      // 不应写入任何数据
    });

    it('Shell 未就绪时应忽略输入', () => {
      mockWs.sessionId = 'test-session';
      const stateNotReady: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: false,
      };
      clientStates.set('test-session', stateNotReady);

      handleSshInput(mockWs, 'test input');

      expect(mockShellStream.write).not.toHaveBeenCalled();
    });

    it('Shell 就绪时应正确写入字符串输入', () => {
      mockWs.sessionId = 'test-session';
      const readyState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: true,
      };
      clientStates.set('test-session', readyState);

      handleSshInput(mockWs, 'ls -la\r');

      expect(mockShellStream.write).toHaveBeenCalledWith('ls -la\r');
    });

    it('应处理对象格式的 payload', () => {
      mockWs.sessionId = 'test-session';
      const readyState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: true,
      };
      clientStates.set('test-session', readyState);

      handleSshInput(mockWs, { data: 'command\r' });

      expect(mockShellStream.write).toHaveBeenCalledWith('command\r');
    });
  });

  describe('handleSshResize', () => {
    it('无活动会话时应忽略调整大小请求', () => {
      handleSshResize(mockWs, { cols: 120, rows: 40 });

      expect(mockShellStream.setWindow).not.toHaveBeenCalled();
    });

    it('无效的尺寸参数应被忽略', () => {
      mockWs.sessionId = 'test-session';
      const readyState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: true,
      };
      clientStates.set('test-session', readyState);

      handleSshResize(mockWs, { cols: -1, rows: 40 });
      expect(mockShellStream.setWindow).not.toHaveBeenCalled();

      handleSshResize(mockWs, { cols: 120, rows: 0 });
      expect(mockShellStream.setWindow).not.toHaveBeenCalled();

      handleSshResize(mockWs, { cols: 'invalid', rows: 40 });
      expect(mockShellStream.setWindow).not.toHaveBeenCalled();

      handleSshResize(mockWs, null);
      expect(mockShellStream.setWindow).not.toHaveBeenCalled();
    });

    it('Shell 就绪时应正确调整终端大小', () => {
      mockWs.sessionId = 'test-session';
      const readyState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: true,
      };
      clientStates.set('test-session', readyState);

      handleSshResize(mockWs, { cols: 120, rows: 40 });

      expect(mockShellStream.setWindow).toHaveBeenCalledWith(40, 120, 0, 0);
    });

    it('Shell 未就绪时应记录警告但不崩溃', () => {
      mockWs.sessionId = 'test-session';
      const notReadyState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: false,
      };
      clientStates.set('test-session', notReadyState);

      // 不应抛出错误
      expect(() => handleSshResize(mockWs, { cols: 120, rows: 40 })).not.toThrow();
      expect(mockShellStream.setWindow).not.toHaveBeenCalled();
    });

    it('有 SSH Client 但无 Shell Stream 时应正常处理', () => {
      mockWs.sessionId = 'test-session';
      const noStreamState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        dbConnectionId: 1,
        isShellReady: false,
      };
      clientStates.set('test-session', noStreamState);

      expect(() => handleSshResize(mockWs, { cols: 120, rows: 40 })).not.toThrow();
    });
  });

  describe('handleSshResumeSuccess', () => {
    it('有效会话应启动状态轮询', async () => {
      const { statusMonitorService } = await import('../state');

      const readyState: ClientState = {
        ws: mockWs,
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        dbConnectionId: 1,
        isShellReady: true,
      };
      clientStates.set('resume-session', readyState);

      handleSshResumeSuccess('resume-session');

      expect(statusMonitorService.startStatusPolling).toHaveBeenCalledWith('resume-session');
    });

    it('无效会话应记录错误但不崩溃', () => {
      // 不应抛出错误
      expect(() => handleSshResumeSuccess('non-existent-session')).not.toThrow();
    });

    it('会话存在但无 SSH Client 时应记录错误', () => {
      const invalidState: ClientState = {
        ws: mockWs,
        sshClient: null as any,
        dbConnectionId: 1,
        isShellReady: false,
      };
      clientStates.set('invalid-session', invalidState);

      expect(() => handleSshResumeSuccess('invalid-session')).not.toThrow();
    });
  });

  describe('SSH Client 事件处理', () => {
    it('SSH Client 关闭事件应触发清理', async () => {
      const { cleanupClientConnection } = await import('../utils');

      (SshService.getConnectionDetails as any).mockResolvedValue({
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'password',
        password: 'testpass',
        proxy: null,
        connection_proxy_setting: null,
      });
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 模拟 SSH Client 关闭
      mockSshClient.emit('close');

      expect(cleanupClientConnection).toHaveBeenCalledWith('mock-session-id-12345');
    });

    it('SSH Client 错误事件应发送错误消息并清理', async () => {
      const { cleanupClientConnection } = await import('../utils');

      (SshService.getConnectionDetails as any).mockResolvedValue({
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'password',
        password: 'testpass',
        proxy: null,
        connection_proxy_setting: null,
      });
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 模拟 SSH Client 错误
      mockSshClient.emit('error', new Error('Network error'));

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'ssh:error',
          payload: 'SSH 连接错误: Network error',
          sid: 'mock-session-id-12345',
        }),
      );
      expect(cleanupClientConnection).toHaveBeenCalledWith('mock-session-id-12345');
    });
  });

  describe('会话挂起日志写入', () => {
    it('标记挂起的会话应写入输出日志', async () => {
      const { temporaryLogStorageService } =
        await import('../../ssh-suspend/temporary-log-storage.service');

      (SshService.getConnectionDetails as any).mockResolvedValue({
        id: 1,
        name: '测试服务器',
        host: '192.168.1.1',
        port: 22,
        username: 'testuser',
        auth_method: 'password',
        password: 'testpass',
        proxy: null,
        connection_proxy_setting: null,
      });
      (SshService.establishSshConnection as any).mockResolvedValue(mockSshClient);

      mockSshClient.shell.mockImplementation((opts, callback) => {
        callback(null, mockShellStream);
      });

      await handleSshConnect(mockWs, mockRequest, { connectionId: 1 });

      // 手动标记会话为挂起状态
      const state = clientStates.get('mock-session-id-12345');
      if (state) {
        state.isMarkedForSuspend = true;
        state.suspendLogPath = '/tmp/test-log.txt';
      }

      // 模拟 Shell 输出
      mockShellStream.emit('data', Buffer.from('test output'));

      // 等待异步操作
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(temporaryLogStorageService.writeToLog).toHaveBeenCalledWith(
        '/tmp/test-log.txt',
        'test output',
      );
    });
  });
});
