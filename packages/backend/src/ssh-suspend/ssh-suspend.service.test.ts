/**
 * SSH Suspend Service 单元测试
 * 测试 SSH 会话挂起与恢复的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import { SshSuspendService } from './ssh-suspend.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const mockLogStorageService = vi.hoisted(() => ({
  ensureLogDirectoryExists: vi.fn(),
  writeToLog: vi.fn(),
  readLog: vi.fn(),
  deleteLog: vi.fn(),
  listLogFiles: vi.fn(),
}));

const mockUuid = vi.hoisted(() => ({
  v4: vi.fn(),
}));

// Mock uuid
vi.mock('uuid', () => mockUuid);

// Mock 日志存储服务
vi.mock('./temporary-log-storage.service', () => ({
  temporaryLogStorageService: mockLogStorageService,
  TemporaryLogStorageService: vi.fn(),
}));

// 创建 mock SSH Client 和 Channel
function createMockSshClient() {
  const client = new EventEmitter();
  (client as any).end = vi.fn();
  return client;
}

function createMockChannel(readable = true, writable = true) {
  const channel = new EventEmitter();
  (channel as any).readable = readable;
  (channel as any).writable = writable;
  (channel as any).end = vi.fn();
  (channel as any).close = vi.fn();
  channel.removeAllListeners = vi.fn().mockReturnThis();
  return channel;
}

describe('SshSuspendService', () => {
  let service: SshSuspendService;

  beforeEach(() => {
    vi.clearAllMocks();
    // 重新设置 uuid mock 返回值（vi.clearAllMocks 会清除之前的设置）
    mockUuid.v4.mockReturnValue('mock-uuid-12345');
    mockLogStorageService.ensureLogDirectoryExists.mockResolvedValue(undefined);
    mockLogStorageService.writeToLog.mockResolvedValue(undefined);
    mockLogStorageService.readLog.mockResolvedValue('log content');
    mockLogStorageService.deleteLog.mockResolvedValue(undefined);
    service = new SshSuspendService(mockLogStorageService as any);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('takeOverMarkedSession', () => {
    it('应成功接管有效的 SSH 会话', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      const suspendSessionId = await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
        customSuspendName: 'My Session',
      });

      expect(suspendSessionId).toBe('mock-uuid-12345');
      expect(mockLogStorageService.ensureLogDirectoryExists).toHaveBeenCalled();
    });

    it('channel 不可读时应返回 null 并清理资源', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel(false, true);

      const result = await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      expect(result).toBeNull();
      expect(mockChannel.end).toHaveBeenCalled();
      expect(mockClient.end).toHaveBeenCalled();
    });

    it('channel 不可写时应返回 null', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel(true, false);

      const result = await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      expect(result).toBeNull();
    });

    it('应为 channel 设置数据监听器并写入日志', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 模拟接收数据
      mockChannel.emit('data', Buffer.from('test output'));

      // 等待异步写入
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(mockLogStorageService.writeToLog).toHaveBeenCalledWith('log-123', 'test output');
    });
  });

  describe('listSuspendedSessions', () => {
    it('应返回用户的所有挂起会话', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
        customSuspendName: 'Session 1',
      });

      const sessions = await service.listSuspendedSessions(1);

      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        suspendSessionId: 'mock-uuid-12345',
        connectionName: 'Test Server',
        connectionId: '1',
        backendSshStatus: 'hanging',
        customSuspendName: 'Session 1',
      });
    });

    it('用户无挂起会话时应返回空数组', async () => {
      const sessions = await service.listSuspendedSessions(999);

      expect(sessions).toEqual([]);
    });
  });

  describe('resumeSession', () => {
    it('应成功恢复挂起的会话', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      mockLogStorageService.readLog.mockResolvedValue('previous log data');

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      const result = await service.resumeSession(1, 'mock-uuid-12345');

      expect(result).not.toBeNull();
      expect(result?.sshClient).toBe(mockClient);
      expect(result?.channel).toBe(mockChannel);
      expect(result?.logData).toBe('previous log data');
      expect(result?.connectionName).toBe('Test Server');
      expect(mockLogStorageService.deleteLog).toHaveBeenCalledWith('log-123');
    });

    it('会话不存在时应返回 null', async () => {
      const result = await service.resumeSession(1, 'nonexistent-session');

      expect(result).toBeNull();
    });

    it('会话已断开时应返回 null', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 模拟断开连接
      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      const result = await service.resumeSession(1, 'mock-uuid-12345');

      expect(result).toBeNull();
    });

    it('读取日志失败时应返回 null', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      mockLogStorageService.readLog.mockRejectedValue(new Error('Read error'));

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      const result = await service.resumeSession(1, 'mock-uuid-12345');

      expect(result).toBeNull();
    });
  });

  describe('terminateSuspendedSession', () => {
    it('应成功终止活跃的挂起会话', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      const result = await service.terminateSuspendedSession(1, 'mock-uuid-12345');

      expect(result).toBe(true);
      expect(mockChannel.close).toHaveBeenCalled();
      expect(mockClient.end).toHaveBeenCalled();
      expect(mockLogStorageService.deleteLog).toHaveBeenCalledWith('log-123');
    });

    it('会话不存在时应返回 false', async () => {
      const result = await service.terminateSuspendedSession(1, 'nonexistent');

      expect(result).toBe(false);
    });

    it('应允许终止已断开的会话', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 模拟断开连接
      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      const result = await service.terminateSuspendedSession(1, 'mock-uuid-12345');

      expect(result).toBe(true);
      expect(mockLogStorageService.deleteLog).toHaveBeenCalledWith('log-123');
    });
  });

  describe('removeDisconnectedSessionEntry', () => {
    it('应成功移除已断开的会话条目', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 先断开连接
      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      const result = await service.removeDisconnectedSessionEntry(1, 'mock-uuid-12345');

      expect(result).toBe(true);
      expect(mockLogStorageService.deleteLog).toHaveBeenCalledWith('log-123');
    });

    it('不应允许直接移除活跃会话', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      const result = await service.removeDisconnectedSessionEntry(1, 'mock-uuid-12345');

      expect(result).toBe(false);
    });

    it('删除日志失败时应返回 false', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      mockLogStorageService.deleteLog.mockRejectedValue(new Error('Delete failed'));

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      const result = await service.removeDisconnectedSessionEntry(1, 'mock-uuid-12345');

      expect(result).toBe(false);
    });
  });

  describe('editSuspendedSessionName', () => {
    it('应成功更新会话名称', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      const result = await service.editSuspendedSessionName(1, 'mock-uuid-12345', 'New Name');

      expect(result).toBe(true);

      // 验证名称已更新
      const sessions = await service.listSuspendedSessions(1);
      expect(sessions[0].customSuspendName).toBe('New Name');
    });

    it('会话不存在时应返回 false', async () => {
      const result = await service.editSuspendedSessionName(1, 'nonexistent', 'Name');

      expect(result).toBe(false);
    });
  });

  describe('handleUnexpectedDisconnection', () => {
    it('应将会话状态更新为 disconnected_by_backend', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      const sessions = await service.listSuspendedSessions(1);
      expect(sessions[0].backendSshStatus).toBe('disconnected_by_backend');
      expect(sessions[0].disconnectionTimestamp).toBeDefined();
    });

    it('应发射 sessionAutoTerminated 事件', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      const eventListener = vi.fn();
      service.on('sessionAutoTerminated', eventListener);

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      expect(eventListener).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 1,
          suspendSessionId: 'mock-uuid-12345',
        })
      );
    });
  });

  describe('getSessionLogContent', () => {
    it('应返回挂起会话的日志内容', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      mockLogStorageService.readLog.mockResolvedValue('session log content');

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
        customSuspendName: 'My Session',
      });

      const result = await service.getSessionLogContent(1, 'mock-uuid-12345');

      expect(result).not.toBeNull();
      expect(result?.content).toBe('session log content');
      expect(result?.filename).toContain('My_Session');
      expect(result?.filename).toContain('.log');
    });

    it('会话不存在时应返回 null', async () => {
      const result = await service.getSessionLogContent(1, 'nonexistent');

      expect(result).toBeNull();
    });

    it('读取日志失败时应返回 null', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      mockLogStorageService.readLog.mockRejectedValue(new Error('Read error'));

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      const result = await service.getSessionLogContent(1, 'mock-uuid-12345');

      expect(result).toBeNull();
    });

    it('应支持已断开会话的日志导出', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      mockLogStorageService.readLog.mockResolvedValue('disconnected session log');

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: mockChannel as any,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 断开会话
      service.handleUnexpectedDisconnection(1, 'mock-uuid-12345');

      const result = await service.getSessionLogContent(1, 'mock-uuid-12345');

      expect(result).not.toBeNull();
      expect(result?.content).toBe('disconnected session log');
    });
  });

  describe('Channel 事件处理', () => {
    it('channel close 事件应更新会话状态', async () => {
      const mockClient = createMockSshClient();
      const mockChannel = createMockChannel();
      // 需要使用真实的 EventEmitter 来触发事件
      const realChannel = new EventEmitter() as any;
      realChannel.readable = true;
      realChannel.writable = true;
      realChannel.end = vi.fn();
      realChannel.close = vi.fn();

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: realChannel,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 触发 close 事件
      realChannel.emit('close');

      const sessions = await service.listSuspendedSessions(1);
      expect(sessions[0].backendSshStatus).toBe('disconnected_by_backend');
    });

    it('channel error 事件应更新会话状态', async () => {
      const mockClient = createMockSshClient();
      const realChannel = new EventEmitter() as any;
      realChannel.readable = true;
      realChannel.writable = true;
      realChannel.end = vi.fn();
      realChannel.close = vi.fn();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await service.takeOverMarkedSession({
        userId: 1,
        originalSessionId: 'original-123',
        sshClient: mockClient as any,
        channel: realChannel,
        connectionName: 'Test Server',
        connectionId: '1',
        logIdentifier: 'log-123',
      });

      // 触发 error 事件
      realChannel.emit('error', new Error('Channel error'));

      const sessions = await service.listSuspendedSessions(1);
      expect(sessions[0].backendSshStatus).toBe('disconnected_by_backend');

      consoleSpy.mockRestore();
    });
  });
});
