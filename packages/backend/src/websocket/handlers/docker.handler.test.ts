/**
 * Docker WebSocket Handler 单元测试
 * 测试 Docker 容器管理的 WebSocket 消息处理逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import {
  fetchRemoteDockerStatus,
  handleDockerGetStatus,
  handleDockerCommand,
  handleDockerGetStats,
  startDockerStatusPolling,
} from './docker.handler';
import { AuthenticatedWebSocket, ClientState } from '../types';
import { clientStates, settingsService } from '../state';

// Mock state module services
vi.mock('../state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../state')>();
  return {
    ...original,
    clientStates: new Map<string, ClientState>(),
    settingsService: {
      getSetting: vi.fn(),
    },
  };
});

// Mock utils
vi.mock('../utils', () => ({
  parsePortsString: vi.fn((ports: string) => {
    if (!ports) return [];
    return ports.split(',').map((p) => ({ raw: p.trim() }));
  }),
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
}));

// Mock SSH Client with exec method
class MockSshClient extends EventEmitter {
  end = vi.fn();
  exec = vi.fn();
}

// Mock exec stream
class MockExecStream extends EventEmitter {
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

// Helper to create mock ClientState
function createMockClientState(
  ws: AuthenticatedWebSocket,
  sshClient: MockSshClient | null = null,
): ClientState {
  return {
    ws,
    sshClient: sshClient as any,
    dbConnectionId: 1,
    isShellReady: true,
  };
}

// Helper to setup SSH exec mock that resolves immediately
function setupExecMockImmediate(
  sshClient: MockSshClient,
  responses: Array<{ stdout?: string; stderr?: string; error?: Error; code?: number }>,
) {
  let callIndex = 0;
  sshClient.exec.mockImplementation(
    (_cmd: string, _opts: unknown, callback: (error: Error | null, stream: unknown) => void) => {
      const response = responses[callIndex] || { stdout: '', stderr: '' };
      callIndex++;

      if (response.error) {
        callback(response.error, null);
        return;
      }

      const stream = new MockExecStream();
      callback(null, stream);

      // 使用 process.nextTick 而不是 setTimeout，确保立即执行
      process.nextTick(() => {
        if (response.stdout) {
          stream.emit('data', Buffer.from(response.stdout));
        }
        if (response.stderr) {
          stream.stderr.emit('data', Buffer.from(response.stderr));
        }
        stream.emit('close', response.code ?? 0);
      });
    },
  );
}

describe('Docker WebSocket Handler', () => {
  let mockWs: AuthenticatedWebSocket;
  let mockSshClient: MockSshClient;

  beforeEach(() => {
    vi.clearAllMocks();
    clientStates.clear();
    mockWs = createMockWebSocket();
    mockSshClient = new MockSshClient();
  });

  afterEach(() => {
    clientStates.clear();
  });

  describe('fetchRemoteDockerStatus', () => {
    it('SSH 客户端不可用时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, null);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('Docker 命令未找到时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      setupExecMockImmediate(mockSshClient, [{ stdout: '', stderr: 'command not found' }]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('Docker daemon 无法连接时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      setupExecMockImmediate(mockSshClient, [
        { stdout: '', stderr: 'Cannot connect to the Docker daemon' },
      ]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('Docker 权限被拒绝时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      setupExecMockImmediate(mockSshClient, [{ stdout: '', stderr: 'permission denied' }]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('Docker 版本命令无输出时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      setupExecMockImmediate(mockSshClient, [{ stdout: '', stderr: '' }]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('应成功获取空容器列表', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' }, // docker version
        { stdout: '', stderr: '' }, // docker ps - no containers
      ]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(0);
    });

    it('应成功获取容器列表', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      const containerJson = JSON.stringify({
        ID: 'abc123def456',
        Names: 'my-container',
        Image: 'nginx:latest',
        State: 'exited',
        Status: 'Exited (0) 2 hours ago',
        Ports: '80/tcp',
      });

      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' }, // docker version
        { stdout: containerJson, stderr: '' }, // docker ps
      ]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(1);
      expect(result.containers[0].id).toBe('abc123def456');
      expect(result.containers[0].Image).toBe('nginx:latest');
      expect(result.containers[0].State).toBe('exited');
    });

    it('应正确解析多个容器', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      const container1 = JSON.stringify({
        ID: 'container1',
        Names: 'nginx',
        Image: 'nginx:latest',
        State: 'exited',
        Status: 'Exited (0)',
      });
      const container2 = JSON.stringify({
        ID: 'container2',
        Names: 'redis',
        Image: 'redis:alpine',
        State: 'exited',
        Status: 'Exited (0)',
      });

      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: `${container1}\n${container2}`, stderr: '' },
      ]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(2);
    });

    it('应处理 JSON 解析错误', async () => {
      const state = createMockClientState(mockWs, mockSshClient);

      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: 'invalid json', stderr: '' },
      ]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result.available).toBe(true);
      expect(result.containers).toHaveLength(0);
    });

    it('exec 错误时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, mockSshClient);
      setupExecMockImmediate(mockSshClient, [{ error: new Error('SSH exec failed') }]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });

    it('docker ps 失败时应返回不可用状态', async () => {
      const state = createMockClientState(mockWs, mockSshClient);

      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' }, // docker version OK
        { stdout: '', stderr: 'Cannot connect to the Docker daemon' }, // docker ps fails
      ]);

      const result = await fetchRemoteDockerStatus(state);

      expect(result).toEqual({ available: false, containers: [] });
    });
  });

  describe('handleDockerGetStatus', () => {
    it('无活动会话时应发送错误', async () => {
      await handleDockerGetStatus(mockWs, 'non-existent-session');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:status:error',
          payload: { message: 'Session state not found.' },
          sid: 'non-existent-session',
        }),
      );
    });

    it('无 SSH 连接时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, null);
      clientStates.set('test-session', state);

      await handleDockerGetStatus(mockWs, 'test-session');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:status:error',
          payload: { message: 'SSH connection not active.' },
          sid: 'test-session',
        }),
      );
    });

    it('应成功返回 Docker 状态', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: '', stderr: '' },
      ]);

      await handleDockerGetStatus(mockWs, 'test-session');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:status:update',
          payload: { available: true, containers: [] },
          sid: 'test-session',
        }),
      );
    });

    it('WebSocket 关闭时不应发送消息', async () => {
      mockWs.readyState = WebSocket.CLOSED;

      await handleDockerGetStatus(mockWs, 'non-existent-session');

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('handleDockerCommand', () => {
    it('无活动会话时应发送错误', async () => {
      await handleDockerCommand(mockWs, 'non-existent-session', { command: 'start' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:command:error',
          payload: { command: 'start', message: 'SSH connection not active.' },
          sid: 'non-existent-session',
        }),
      );
    });

    it('无效的 containerId 应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      await handleDockerCommand(mockWs, 'test-session', { command: 'start' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:command:error',
          payload: { command: 'start', message: 'Invalid containerId or command.' },
          sid: 'test-session',
        }),
      );
    });

    it('无效的 command 应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123',
        command: 'invalid',
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:command:error',
          payload: { message: 'Invalid containerId or command.' },
          sid: 'test-session',
        }),
      );
    });

    it('应成功执行 start 命令', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: 'abc123', stderr: '', code: 0 }]);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123',
        command: 'start',
      });

      expect(mockSshClient.exec).toHaveBeenCalledWith(
        'docker start abc123',
        { pty: false },
        expect.any(Function),
      );
    });

    it('应成功执行 stop 命令', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: 'abc123', stderr: '', code: 0 }]);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123',
        command: 'stop',
      });

      expect(mockSshClient.exec).toHaveBeenCalledWith(
        'docker stop abc123',
        { pty: false },
        expect.any(Function),
      );
    });

    it('应成功执行 restart 命令', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: 'abc123', stderr: '', code: 0 }]);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123',
        command: 'restart',
      });

      expect(mockSshClient.exec).toHaveBeenCalledWith(
        'docker restart abc123',
        { pty: false },
        expect.any(Function),
      );
    });

    it('应成功执行 remove 命令', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: 'abc123', stderr: '', code: 0 }]);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123',
        command: 'remove',
      });

      expect(mockSshClient.exec).toHaveBeenCalledWith(
        'docker rm -f abc123',
        { pty: false },
        expect.any(Function),
      );
    });

    it('应拒绝非法 containerId 防止命令注入', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123; rm -rf /',
        command: 'start',
      });

      // 验证非法 containerId 被拒绝，不执行命令
      expect(mockSshClient.exec).not.toHaveBeenCalled();
    });

    it('命令执行失败时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [
        { stdout: '', stderr: 'Container not found', code: 1 },
      ]);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: 'abc123',
        command: 'start',
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"docker:command:error"'),
      );
    });

    it('净化后 containerId 为空时应报错', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      await handleDockerCommand(mockWs, 'test-session', {
        containerId: ';;;', // 全部是非法字符
        command: 'start',
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"docker:command:error"'),
      );
    });
  });

  describe('handleDockerGetStats', () => {
    it('无活动会话时应发送错误', async () => {
      await handleDockerGetStats(mockWs, 'non-existent-session', { containerId: 'abc123' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: 'abc123', message: 'SSH connection not active.' },
          sid: 'non-existent-session',
        }),
      );
    });

    it('缺少 containerId 时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      await handleDockerGetStats(mockWs, 'test-session', {});

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: undefined, message: 'Missing containerId.' },
          sid: 'test-session',
        }),
      );
    });

    it('无效 containerId 格式应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      await handleDockerGetStats(mockWs, 'test-session', { containerId: ';;;' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: ';;;', message: 'Invalid container ID format.' },
          sid: 'test-session',
        }),
      );
    });

    it('应成功返回容器统计信息', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      const statsJson = JSON.stringify({
        ID: 'abc123',
        CPUPerc: '0.5%',
        MemUsage: '100MiB / 1GiB',
        MemPerc: '10%',
        NetIO: '1kB / 2kB',
        BlockIO: '0B / 0B',
      });

      setupExecMockImmediate(mockSshClient, [{ stdout: statsJson, stderr: '' }]);

      await handleDockerGetStats(mockWs, 'test-session', { containerId: 'abc123' });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"docker:stats:update"'),
      );
    });

    it('统计信息为空时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: '', stderr: '' }]);

      await handleDockerGetStats(mockWs, 'test-session', { containerId: 'abc123' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: {
            containerId: 'abc123',
            message: 'No stats data received (container might be stopped).',
          },
          sid: 'test-session',
        }),
      );
    });

    it('stderr 输出时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: '', stderr: 'Container not running' }]);

      await handleDockerGetStats(mockWs, 'test-session', { containerId: 'abc123' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: 'abc123', message: 'Container not running' },
          sid: 'test-session',
        }),
      );
    });

    it('JSON 解析失败时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ stdout: 'invalid json', stderr: '' }]);

      await handleDockerGetStats(mockWs, 'test-session', { containerId: 'abc123' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'docker:stats:error',
          payload: { containerId: 'abc123', message: 'Failed to parse stats data.' },
          sid: 'test-session',
        }),
      );
    });

    it('exec 出错时应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      setupExecMockImmediate(mockSshClient, [{ error: new Error('SSH connection lost') }]);

      await handleDockerGetStats(mockWs, 'test-session', { containerId: 'abc123' });

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"docker:stats:error"'),
      );
    });
  });

  describe('startDockerStatusPolling', () => {
    it('不存在的会话应警告并返回', async () => {
      // 不应抛出错误
      await expect(startDockerStatusPolling('non-existent-session')).resolves.not.toThrow();
    });

    it('应调用设置服务获取轮询间隔', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      vi.mocked(settingsService.getSetting).mockResolvedValue('5');
      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: '', stderr: '' },
      ]);

      await startDockerStatusPolling('test-session');

      expect(settingsService.getSetting).toHaveBeenCalledWith('dockerStatusIntervalSeconds');

      // 清理间隔
      if (state.dockerStatusIntervalId) {
        clearInterval(state.dockerStatusIntervalId);
      }
    });

    it('应设置 dockerStatusIntervalId', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      vi.mocked(settingsService.getSetting).mockResolvedValue(null);
      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: '', stderr: '' },
      ]);

      await startDockerStatusPolling('test-session');

      expect(state.dockerStatusIntervalId).toBeDefined();

      // 清理
      if (state.dockerStatusIntervalId) {
        clearInterval(state.dockerStatusIntervalId);
      }
    });

    it('应清除已存在的轮询间隔', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      const existingInterval = setInterval(() => {}, 10000);
      state.dockerStatusIntervalId = existingInterval;
      clientStates.set('test-session', state);

      vi.mocked(settingsService.getSetting).mockResolvedValue(null);
      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: '', stderr: '' },
      ]);

      await startDockerStatusPolling('test-session');

      // 验证旧的间隔被替换
      expect(state.dockerStatusIntervalId).not.toBe(existingInterval);

      // 清理
      clearInterval(existingInterval);
      if (state.dockerStatusIntervalId) {
        clearInterval(state.dockerStatusIntervalId);
      }
    });

    it('应发送初始 Docker 状态', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs, mockSshClient);
      clientStates.set('test-session', state);

      vi.mocked(settingsService.getSetting).mockResolvedValue('60'); // 长间隔避免轮询干扰
      setupExecMockImmediate(mockSshClient, [
        { stdout: '20.10.0', stderr: '' },
        { stdout: '', stderr: '' },
      ]);

      await startDockerStatusPolling('test-session');

      // 应发送初始状态
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"type":"docker:status:update"'),
      );

      // 清理
      if (state.dockerStatusIntervalId) {
        clearInterval(state.dockerStatusIntervalId);
      }
    });
  });
});
