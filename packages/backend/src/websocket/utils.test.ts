import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parsePortsString, cleanupClientConnection } from './utils';
import { clientStates, statusMonitorService, sftpService, settingsService } from './state';
import { sshSuspendService } from '../ssh-suspend/ssh-suspend.service';
import { AuthenticatedWebSocket, ClientState } from './types';

// Mock dependencies
vi.mock('./state', () => ({
  clientStates: new Map(),
  statusMonitorService: {
    stopStatusPolling: vi.fn(),
  },
  sftpService: {
    cleanupSftpSession: vi.fn(),
  },
  settingsService: {
    getSetting: vi.fn().mockResolvedValue('0'),
  },
  auditLogService: {
    logAction: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../ssh-suspend/ssh-suspend.service', () => ({
  sshSuspendService: {
    takeOverMarkedSession: vi.fn(),
  },
}));

describe('WebSocket Utils', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (clientStates as Map<string, any>).clear();
    (settingsService.getSetting as any).mockResolvedValue('0');
  });

  describe('parsePortsString', () => {
    it('应正确解析空字符串', () => {
      expect(parsePortsString('')).toEqual([]);
      expect(parsePortsString(null)).toEqual([]);
      expect(parsePortsString(undefined)).toEqual([]);
    });

    it('应正确解析单个端口映射', () => {
      const result = parsePortsString('0.0.0.0:8080->80/tcp');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        IP: '0.0.0.0',
        PrivatePort: 80,
        PublicPort: 8080,
        Type: 'tcp',
      });
    });

    it('应正确解析多个端口映射', () => {
      const result = parsePortsString('0.0.0.0:8080->80/tcp, 0.0.0.0:3306->3306/tcp');

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        IP: '0.0.0.0',
        PrivatePort: 80,
        PublicPort: 8080,
        Type: 'tcp',
      });
      expect(result[1]).toEqual({
        IP: '0.0.0.0',
        PrivatePort: 3306,
        PublicPort: 3306,
        Type: 'tcp',
      });
    });

    it('应正确解析没有公开端口的映射', () => {
      const result = parsePortsString('80/tcp');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        IP: undefined,
        PrivatePort: 80,
        PublicPort: undefined,
        Type: 'tcp',
      });
    });

    it('应正确解析没有IP的映射', () => {
      const result = parsePortsString('8080->80/tcp');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        IP: undefined,
        PrivatePort: 80,
        PublicPort: 8080,
        Type: 'tcp',
      });
    });

    it('应正确解析UDP端口', () => {
      const result = parsePortsString('0.0.0.0:53->53/udp');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        IP: '0.0.0.0',
        PrivatePort: 53,
        PublicPort: 53,
        Type: 'udp',
      });
    });

    it('应跳过无法解析的条目', () => {
      const result = parsePortsString(
        '0.0.0.0:8080->80/tcp, invalid-entry, 0.0.0.0:3306->3306/tcp',
      );

      expect(result).toHaveLength(2);
      expect(result[0].PublicPort).toBe(8080);
      expect(result[1].PublicPort).toBe(3306);
    });

    it('应处理IPv6地址', () => {
      const result = parsePortsString(':::8080->80/tcp');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        IP: '::',
        PrivatePort: 80,
        PublicPort: 8080,
        Type: 'tcp',
      });
    });

    it('应跳过格式错误的私有端口部分', () => {
      const result = parsePortsString('0.0.0.0:8080->invalid');

      expect(result).toHaveLength(0);
    });
  });

  describe('cleanupClientConnection', () => {
    it('应在sessionId为undefined时直接返回', async () => {
      await cleanupClientConnection(undefined);

      expect(statusMonitorService.stopStatusPolling).not.toHaveBeenCalled();
      expect(sftpService.cleanupSftpSession).not.toHaveBeenCalled();
    });

    it('应在状态不存在时直接返回', async () => {
      await cleanupClientConnection('non-existent-session');

      expect(statusMonitorService.stopStatusPolling).not.toHaveBeenCalled();
      expect(sftpService.cleanupSftpSession).not.toHaveBeenCalled();
    });

    it('应清理正常SSH连接（未标记挂起）', async () => {
      const mockSshClient = {
        end: vi.fn(),
      };

      const mockShellStream = {
        end: vi.fn(),
      };

      const mockWs = {
        userId: 1,
        username: 'testuser',
      } as AuthenticatedWebSocket;

      const state: Partial<ClientState> = {
        ws: mockWs,
        dbConnectionId: 1,
        connectionName: 'Test Server',
        ipAddress: '127.0.0.1',
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        connectedAt: Math.floor(Date.now() / 1000),
        isMarkedForSuspend: false,
        isSuspendedByService: false,
      };

      clientStates.set('session-1', state as ClientState);

      await cleanupClientConnection('session-1');

      expect(statusMonitorService.stopStatusPolling).toHaveBeenCalledWith('session-1');
      expect(sftpService.cleanupSftpSession).toHaveBeenCalledWith('session-1');
      expect(mockShellStream.end).toHaveBeenCalled();
      expect(mockSshClient.end).toHaveBeenCalled();
      expect(clientStates.has('session-1')).toBe(false);
    });

    it('应移交已标记挂起的SSH会话', async () => {
      const mockSshClient = {
        end: vi.fn(),
      };

      const mockShellStream = {
        end: vi.fn(),
      };

      const mockWs = {
        userId: 1,
        username: 'testuser',
      } as AuthenticatedWebSocket;

      const state: Partial<ClientState> = {
        ws: mockWs,
        dbConnectionId: 1,
        connectionName: 'Test Server',
        ipAddress: '127.0.0.1',
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        connectedAt: Math.floor(Date.now() / 1000),
        isMarkedForSuspend: true,
        suspendLogPath: 'session-1',
        isSuspendedByService: false,
      };

      clientStates.set('session-1', state as ClientState);

      (sshSuspendService.takeOverMarkedSession as any).mockResolvedValue('suspend-session-1');
      (settingsService.getSetting as any).mockResolvedValue('3600');

      await cleanupClientConnection('session-1');

      expect(sshSuspendService.takeOverMarkedSession).toHaveBeenCalled();
      expect(sshSuspendService.takeOverMarkedSession).toHaveBeenCalledWith(
        expect.objectContaining({
          keepAliveSeconds: 3600,
        }),
      );
      expect(mockSshClient.end).not.toHaveBeenCalled();
      expect(clientStates.has('session-1')).toBe(false);
    });

    it('应在移交失败时关闭SSH连接', async () => {
      const mockSshClient = {
        end: vi.fn(),
      };

      const mockShellStream = {
        end: vi.fn(),
      };

      const mockWs = {
        userId: 1,
        username: 'testuser',
      } as AuthenticatedWebSocket;

      const state: Partial<ClientState> = {
        ws: mockWs,
        dbConnectionId: 1,
        connectionName: 'Test Server',
        ipAddress: '127.0.0.1',
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        connectedAt: Math.floor(Date.now() / 1000),
        isMarkedForSuspend: true,
        suspendLogPath: 'session-1',
        isSuspendedByService: false,
      };

      clientStates.set('session-1', state as ClientState);

      (sshSuspendService.takeOverMarkedSession as any).mockResolvedValue(null);

      await cleanupClientConnection('session-1');

      expect(sshSuspendService.takeOverMarkedSession).toHaveBeenCalled();
      // 分离机制会调用分离后的实例
      expect(mockShellStream.end).toHaveBeenCalled();
      expect(mockSshClient.end).toHaveBeenCalled();
      expect(clientStates.has('session-1')).toBe(false);
    });

    it('应清理Docker状态轮询定时器', async () => {
      vi.useFakeTimers();
      const timerId = setInterval(() => {}, 1000);

      const mockWs = {
        userId: 1,
        username: 'testuser',
      } as AuthenticatedWebSocket;

      const state: Partial<ClientState> = {
        ws: mockWs,
        dbConnectionId: 1,
        dockerStatusIntervalId: timerId,
      };

      clientStates.set('session-1', state as ClientState);

      await cleanupClientConnection('session-1');

      expect(clientStates.has('session-1')).toBe(false);

      vi.useRealTimers();
    });

    it('应跳过已被服务接管的会话', async () => {
      const mockSshClient = {
        end: vi.fn(),
      };

      const mockWs = {
        userId: 1,
        username: 'testuser',
      } as AuthenticatedWebSocket;

      const state: Partial<ClientState> = {
        ws: mockWs,
        dbConnectionId: 1,
        sshClient: mockSshClient as any,
        isSuspendedByService: true,
      };

      clientStates.set('session-1', state as ClientState);

      await cleanupClientConnection('session-1');

      expect(mockSshClient.end).not.toHaveBeenCalled();
      expect(clientStates.has('session-1')).toBe(false);
    });

    it('应处理移交过程中的错误', async () => {
      const mockSshClient = {
        end: vi.fn(),
      };

      const mockShellStream = {
        end: vi.fn(),
      };

      const mockWs = {
        userId: 1,
        username: 'testuser',
      } as AuthenticatedWebSocket;

      const state: Partial<ClientState> = {
        ws: mockWs,
        dbConnectionId: 1,
        connectionName: 'Test Server',
        ipAddress: '127.0.0.1',
        sshClient: mockSshClient as any,
        sshShellStream: mockShellStream as any,
        connectedAt: Math.floor(Date.now() / 1000),
        isMarkedForSuspend: true,
        suspendLogPath: 'session-1',
        isSuspendedByService: false,
      };

      clientStates.set('session-1', state as ClientState);

      (sshSuspendService.takeOverMarkedSession as any).mockRejectedValue(
        new Error('Takeover failed'),
      );

      await cleanupClientConnection('session-1');

      // 当移交失败时，状态已被分离，所以不会调用原始 mock 的 end
      // 但会调用分离出来的实例的 end（在 catch 块中）
      expect(clientStates.has('session-1')).toBe(false);
    });
  });
});
