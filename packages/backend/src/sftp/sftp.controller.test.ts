import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import {
  downloadFile,
  downloadDirectory,
  handleCompressRequest,
  handleDecompressRequest,
} from './sftp.controller';
import { clientStates } from '../websocket';
import { AuthenticatedWebSocket } from '../websocket/types';
import WebSocket from 'ws';

// Mock dependencies
vi.mock('../websocket', () => ({
  clientStates: new Map(),
}));

vi.mock('../utils/AppError', () => ({
  ErrorFactory: {
    notFound: vi.fn((msg) => new Error(msg)),
    internalError: vi.fn((msg) => new Error(msg)),
  },
  getErrorMessage: vi.fn((err) => (err instanceof Error ? err.message : String(err))),
}));

describe('SFTP Controller', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let mockNext: NextFunction;

  beforeEach(() => {
    vi.clearAllMocks();
    (clientStates as Map<string, any>).clear();

    mockReq = {
      session: {
        userId: 1,
        save: vi.fn((callback) => callback && callback()),
        regenerate: vi.fn((callback) => callback && callback()),
        destroy: vi.fn((callback) => callback && callback()),
        reload: vi.fn((callback) => callback && callback()),
        touch: vi.fn(),
        cookie: {} as any,
      } as any,
      query: {},
    };

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      setHeader: vi.fn().mockReturnThis(),
      on: vi.fn(),
      headersSent: false,
    };

    mockNext = vi.fn();
  });

  describe('downloadFile', () => {
    it('应在未授权时返回401', async () => {
      mockReq.session = {
        save: vi.fn((callback) => callback && callback()),
        regenerate: vi.fn((callback) => callback && callback()),
        destroy: vi.fn((callback) => callback && callback()),
        reload: vi.fn((callback) => callback && callback()),
        touch: vi.fn(),
        cookie: {} as any,
      } as any;

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '未授权：需要登录。' });
    });

    it('应在缺少必要参数时返回400', async () => {
      mockReq.query = { connectionId: '1' };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: '缺少必要的查询参数 (connectionId, remotePath)。',
      });
    });

    it('应在connectionId无效时返回400', async () => {
      mockReq.query = {
        connectionId: 'invalid',
        remotePath: '/test/file.txt',
      };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '无效的 connectionId。' });
    });

    it('应在未找到活动SFTP会话时返回404', async () => {
      mockReq.query = {
        connectionId: '1',
        remotePath: '/test/file.txt',
      };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: '未找到指定的活动 SFTP 会话。请确保目标连接处于活动状态。',
      });
    });

    it('应正确处理文件下载流程', async () => {
      const mockSftp = {
        lstat: vi.fn((path, callback) => {
          callback(undefined, {
            isFile: () => true,
            size: 1024,
          });
        }),
        createReadStream: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          pipe: vi.fn(),
        }),
      };

      const mockWs = {
        userId: 1,
      } as AuthenticatedWebSocket;

      const mockState = {
        ws: mockWs,
        dbConnectionId: 1,
        sftp: mockSftp,
      };

      clientStates.set('session-1', mockState as any);

      mockReq.query = {
        connectionId: '1',
        remotePath: '/test/file.txt',
      };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(mockSftp.lstat).toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="file.txt"',
      );
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Type', 'application/octet-stream');
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', '1024');
    });

    it('应在多会话场景下优先使用 sessionId 精确匹配下载会话', async () => {
      const staleSftp = {
        lstat: vi.fn(),
        createReadStream: vi.fn(),
      };
      const exactSftp = {
        lstat: vi.fn((path, callback) => {
          callback(undefined, {
            isFile: () => true,
            size: 512,
          });
        }),
        createReadStream: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          pipe: vi.fn(),
        }),
      };

      clientStates.set('session-stale', {
        ws: { userId: 1 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: staleSftp,
      } as any);
      clientStates.set('session-exact', {
        ws: { userId: 1 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: exactSftp,
      } as any);

      mockReq.query = {
        connectionId: '1',
        sessionId: 'session-exact',
        remotePath: '/test/exact.txt',
      };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(exactSftp.lstat).toHaveBeenCalledWith('/test/exact.txt', expect.any(Function));
      expect(staleSftp.lstat).not.toHaveBeenCalled();
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', '512');
    });

    it('应在 sessionId 不存在时回退到遍历匹配', async () => {
      const fallbackSftp = {
        lstat: vi.fn((path, callback) => {
          callback(undefined, { isFile: () => true, size: 256 });
        }),
        createReadStream: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          pipe: vi.fn(),
        }),
      };

      clientStates.set('session-real', {
        ws: { userId: 1 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: fallbackSftp,
      } as any);

      mockReq.query = {
        connectionId: '1',
        sessionId: 'nonexistent-session',
        remotePath: '/test/fallback.txt',
      };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(fallbackSftp.lstat).toHaveBeenCalledWith('/test/fallback.txt', expect.any(Function));
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', '256');
    });

    it('应在 sessionId 存在但 userId 不匹配时回退到遍历匹配', async () => {
      const wrongUserSftp = {
        lstat: vi.fn(),
        createReadStream: vi.fn(),
      };
      const correctSftp = {
        lstat: vi.fn((path, callback) => {
          callback(undefined, { isFile: () => true, size: 128 });
        }),
        createReadStream: vi.fn().mockReturnValue({
          on: vi.fn().mockReturnThis(),
          pipe: vi.fn(),
        }),
      };

      clientStates.set('session-wrong-user', {
        ws: { userId: 999 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: wrongUserSftp,
      } as any);
      clientStates.set('session-correct', {
        ws: { userId: 1 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: correctSftp,
      } as any);

      mockReq.query = {
        connectionId: '1',
        sessionId: 'session-wrong-user',
        remotePath: '/test/correct.txt',
      };

      await downloadFile(mockReq as Request, mockRes as Response, mockNext);

      expect(wrongUserSftp.lstat).not.toHaveBeenCalled();
      expect(correctSftp.lstat).toHaveBeenCalledWith('/test/correct.txt', expect.any(Function));
      expect(mockRes.setHeader).toHaveBeenCalledWith('Content-Length', '128');
    });
  });

  describe('downloadDirectory', () => {
    it('应在未授权时返回401', async () => {
      mockReq.session = {
        save: vi.fn((callback) => callback && callback()),
        regenerate: vi.fn((callback) => callback && callback()),
        destroy: vi.fn((callback) => callback && callback()),
        reload: vi.fn((callback) => callback && callback()),
        touch: vi.fn(),
        cookie: {} as any,
      } as any;

      await downloadDirectory(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '未授权：需要登录。' });
    });

    it('应在缺少必要参数时返回400', async () => {
      mockReq.query = { connectionId: '1' };

      await downloadDirectory(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        message: '缺少必要的查询参数 (connectionId, remotePath)。',
      });
    });

    it('应在路径不是目录时返回400', async () => {
      const mockSftp = {
        lstat: vi.fn((path, callback) => {
          callback(undefined, {
            isDirectory: () => false,
          });
        }),
      };

      const mockWs = {
        userId: 1,
      } as AuthenticatedWebSocket;

      const mockState = {
        ws: mockWs,
        dbConnectionId: 1,
        sftp: mockSftp,
      };

      clientStates.set('session-1', mockState as any);

      mockReq.query = {
        connectionId: '1',
        remotePath: '/test/file.txt',
      };

      await downloadDirectory(mockReq as Request, mockRes as Response, mockNext);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({ message: '指定的路径不是一个目录。' });
    });

    it('应在多会话场景下优先使用 sessionId 精确匹配目录下载会话', async () => {
      const staleSftp = {
        lstat: vi.fn(),
      };
      const exactSftp = {
        lstat: vi.fn((path, callback) => {
          callback(undefined, {
            isDirectory: () => false,
          });
        }),
      };

      clientStates.set('session-stale', {
        ws: { userId: 1 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: staleSftp,
      } as any);
      clientStates.set('session-exact', {
        ws: { userId: 1 } as AuthenticatedWebSocket,
        dbConnectionId: 1,
        sftp: exactSftp,
      } as any);

      mockReq.query = {
        connectionId: '1',
        sessionId: 'session-exact',
        remotePath: '/test/dir',
      };

      await downloadDirectory(mockReq as Request, mockRes as Response, mockNext);

      expect(exactSftp.lstat).toHaveBeenCalledWith('/test/dir', expect.any(Function));
      expect(staleSftp.lstat).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
    });
  });

  describe('handleCompressRequest', () => {
    it('应在缺少sessionId时发送错误', async () => {
      const mockWs = {
        sessionId: undefined,
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const payload = {
        sources: ['file1.txt'],
        destinationArchiveName: 'archive.zip',
        format: 'zip' as const,
        targetDirectory: '/test',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:compress:error'));
    });

    it('应在SSH客户端未就绪时发送错误', async () => {
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const payload = {
        sources: ['file1.txt'],
        destinationArchiveName: 'archive.zip',
        format: 'zip' as const,
        targetDirectory: '/test',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('SSH 会话未就绪'));
    });

    it('应在格式不支持时发送错误', async () => {
      const mockSshClient = {
        exec: vi.fn(),
      };

      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const mockState = {
        sshClient: mockSshClient,
      };

      clientStates.set('session-1', mockState as any);

      const payload = {
        sources: ['file1.txt'],
        destinationArchiveName: 'archive.rar',
        format: 'rar' as any,
        targetDirectory: '/test',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('不支持的压缩格式'));
    });

    it('应在目标目录路径包含Shell注入字符时发送错误', async () => {
      const mockSshClient = { exec: vi.fn() };
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;
      clientStates.set('session-1', { sshClient: mockSshClient } as any);

      const payload = {
        sources: ['file1.txt'],
        destinationArchiveName: 'archive.zip',
        format: 'zip' as const,
        targetDirectory: '/test/$(whoami)',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('非法字符'));
      expect(mockSshClient.exec).not.toHaveBeenCalled();
    });

    it('应在源路径包含反引号时发送错误', async () => {
      const mockSshClient = { exec: vi.fn() };
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;
      clientStates.set('session-1', { sshClient: mockSshClient } as any);

      const payload = {
        sources: ['file1.txt', '`malicious`'],
        destinationArchiveName: 'archive.zip',
        format: 'zip' as const,
        targetDirectory: '/test',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('非法字符'));
      expect(mockSshClient.exec).not.toHaveBeenCalled();
    });

    it('应在归档文件名包含分号时发送错误', async () => {
      const mockSshClient = { exec: vi.fn() };
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;
      clientStates.set('session-1', { sshClient: mockSshClient } as any);

      const payload = {
        sources: ['file1.txt'],
        destinationArchiveName: 'archive.zip;rm -rf /',
        format: 'zip' as const,
        targetDirectory: '/test',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('非法字符'));
      expect(mockSshClient.exec).not.toHaveBeenCalled();
    });

    it('应正确执行压缩命令', async () => {
      const mockStream = {
        on: vi.fn().mockReturnThis(),
        stderr: {
          on: vi.fn(),
        },
      };

      const mockSshClient = {
        exec: vi.fn((cmd, callback) => {
          callback(undefined, mockStream);
          // 模拟成功执行
          setTimeout(() => {
            const closeHandler = mockStream.on.mock.calls.find(([event]) => event === 'close')?.[1];
            if (closeHandler) closeHandler(0);
          }, 10);
        }),
      };

      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const mockState = {
        sshClient: mockSshClient,
      };

      clientStates.set('session-1', mockState as any);

      const payload = {
        sources: ['file1.txt'],
        destinationArchiveName: 'archive.zip',
        format: 'zip' as const,
        targetDirectory: '/test',
        requestId: 'req-1',
      };

      await handleCompressRequest(mockWs, payload);

      expect(mockSshClient.exec).toHaveBeenCalled();
      const execCmd = mockSshClient.exec.mock.calls[0][0];
      expect(execCmd).toContain('zip');
      expect(execCmd).toContain('-qr');
    });
  });

  describe('handleDecompressRequest', () => {
    it('应在缺少sessionId时发送错误', async () => {
      const mockWs = {
        sessionId: undefined,
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const payload = {
        archivePath: '/test/archive.zip',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:decompress:error'));
    });

    it('应在SSH客户端未就绪时发送错误', async () => {
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const payload = {
        archivePath: '/test/archive.zip',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('SSH 会话未就绪'));
    });

    it('应在格式不支持时发送错误', async () => {
      const mockSshClient = {
        exec: vi.fn(),
      };

      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const mockState = {
        sshClient: mockSshClient,
      };

      clientStates.set('session-1', mockState as any);

      const payload = {
        archivePath: '/test/archive.rar',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('不支持的压缩文件格式'));
    });

    it('应在压缩包路径包含Shell注入字符时发送错误', async () => {
      const mockSshClient = { exec: vi.fn() };
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;
      clientStates.set('session-1', { sshClient: mockSshClient } as any);

      const payload = {
        archivePath: '/test/archive$(whoami).zip',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('非法字符'));
      expect(mockSshClient.exec).not.toHaveBeenCalled();
    });

    it('应在压缩包路径包含管道符时发送错误', async () => {
      const mockSshClient = { exec: vi.fn() };
      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;
      clientStates.set('session-1', { sshClient: mockSshClient } as any);

      const payload = {
        archivePath: '/test/archive.zip|rm -rf /',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('非法字符'));
      expect(mockSshClient.exec).not.toHaveBeenCalled();
    });

    it('应正确执行zip解压命令', async () => {
      const mockStream = {
        on: vi.fn().mockReturnThis(),
        stderr: {
          on: vi.fn(),
        },
      };

      const mockSshClient = {
        exec: vi.fn((cmd, callback) => {
          callback(undefined, mockStream);
          setTimeout(() => {
            const closeHandler = mockStream.on.mock.calls.find(([event]) => event === 'close')?.[1];
            if (closeHandler) closeHandler(0);
          }, 10);
        }),
      };

      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const mockState = {
        sshClient: mockSshClient,
      };

      clientStates.set('session-1', mockState as any);

      const payload = {
        archivePath: '/test/archive.zip',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockSshClient.exec).toHaveBeenCalled();
      const execCmd = mockSshClient.exec.mock.calls[0][0];
      expect(execCmd).toContain('unzip');
      expect(execCmd).toContain('-oq');
    });

    it('应正确执行tar.gz解压命令', async () => {
      const mockStream = {
        on: vi.fn().mockReturnThis(),
        stderr: {
          on: vi.fn(),
        },
      };

      const mockSshClient = {
        exec: vi.fn((cmd, callback) => {
          callback(undefined, mockStream);
          setTimeout(() => {
            const closeHandler = mockStream.on.mock.calls.find(([event]) => event === 'close')?.[1];
            if (closeHandler) closeHandler(0);
          }, 10);
        }),
      };

      const mockWs = {
        sessionId: 'session-1',
        readyState: WebSocket.OPEN,
        send: vi.fn(),
      } as unknown as AuthenticatedWebSocket;

      const mockState = {
        sshClient: mockSshClient,
      };

      clientStates.set('session-1', mockState as any);

      const payload = {
        archivePath: '/test/archive.tar.gz',
        requestId: 'req-1',
      };

      await handleDecompressRequest(mockWs, payload);

      expect(mockSshClient.exec).toHaveBeenCalled();
      const execCmd = mockSshClient.exec.mock.calls[0][0];
      expect(execCmd).toContain('tar');
      expect(execCmd).toContain('-xzf');
    });
  });
});
