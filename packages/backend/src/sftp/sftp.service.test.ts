/**
 * SFTP Service 单元测试
 * 测试 SFTP 文件操作的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { WebSocket } from 'ws';

import { SftpService } from './sftp.service';
import * as jschardet from 'jschardet';
import * as iconv from 'iconv-lite';

// Mock ClientState 和相关类型
interface MockStats {
  size: number;
  uid: number;
  gid: number;
  mode: number;
  atime: number;
  mtime: number;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
}

interface MockSftpDirEntry {
  filename: string;
  longname: string;
  attrs: MockStats;
}

// Mock SFTPWrapper
class MockSftpWrapper extends EventEmitter {
  readdir = vi.fn();
  lstat = vi.fn();
  stat = vi.fn();
  createReadStream = vi.fn();
  createWriteStream = vi.fn();
  mkdir = vi.fn();
  rmdir = vi.fn();
  unlink = vi.fn();
  rename = vi.fn();
  chmod = vi.fn();
  realpath = vi.fn();
  open = vi.fn();
  close = vi.fn();
  end = vi.fn();
}

// Mock SSH Client
class MockSshClient extends EventEmitter {
  sftp = vi.fn();
  exec = vi.fn();
  end = vi.fn();
}

// Mock WebSocket
class MockWebSocket {
  readyState = WebSocket.OPEN;
  send = vi.fn();
}

// Mock ReadStream
class MockReadStream extends EventEmitter {
  destroy = vi.fn();
  pipe = vi.fn().mockReturnThis();
}

// Mock WriteStream
class MockWriteStream extends EventEmitter {
  write = vi.fn();
  end = vi.fn();
  destroy = vi.fn();
  destroyed = false;
  writableEnded = false;
}

// Mock jschardet
vi.mock('jschardet', () => ({
  default: {
    detect: vi.fn(() => ({ encoding: 'utf-8', confidence: 0.99 })),
  },
  detect: vi.fn(() => ({ encoding: 'utf-8', confidence: 0.99 })),
}));

// Mock iconv-lite
vi.mock('iconv-lite', () => ({
  default: {
    decode: vi.fn((buffer: Buffer, encoding: string) => buffer.toString()),
    encode: vi.fn((str: string, encoding: string) => Buffer.from(str)),
    encodingExists: vi.fn(() => true),
  },
  decode: vi.fn((buffer: Buffer, encoding: string) => buffer.toString()),
  encode: vi.fn((str: string, encoding: string) => Buffer.from(str)),
  encodingExists: vi.fn(() => true),
}));

describe('SftpService', () => {
  let service: SftpService;
  let clientStates: Map<string, any>;
  let mockSshClient: MockSshClient;
  let mockSftp: MockSftpWrapper;
  let mockWs: MockWebSocket;

  const sessionId = 'test-session-123';
  const requestId = 'req-456';

  beforeEach(() => {
    vi.clearAllMocks();

    mockSshClient = new MockSshClient();
    mockSftp = new MockSftpWrapper();
    mockWs = new MockWebSocket();

    clientStates = new Map();
    clientStates.set(sessionId, {
      sshClient: mockSshClient,
      sftp: mockSftp,
      ws: mockWs,
      dbConnectionId: 1,
    });

    service = new SftpService(clientStates);
  });

  afterEach(() => {
    // 注意：不要使用 vi.resetAllMocks()，它会清除 mock 函数的实现
    // vi.clearAllMocks() 已在 beforeEach 中执行，用于清除调用记录
  });

  describe('initializeSftpSession', () => {
    it('应成功初始化 SFTP 会话', async () => {
      const stateWithoutSftp = {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
        dbConnectionId: 1,
      };
      clientStates.set(sessionId, stateWithoutSftp);

      mockSshClient.sftp.mockImplementation((callback: any) => {
        callback(null, mockSftp);
      });

      await service.initializeSftpSession(sessionId);

      expect(mockSshClient.sftp).toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp_ready'));
    });

    it('SSH 客户端不存在时应跳过初始化', async () => {
      clientStates.set(sessionId, {
        sshClient: null,
        sftp: undefined,
        ws: mockWs,
        dbConnectionId: 1,
      });

      await service.initializeSftpSession(sessionId);

      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('SFTP 已初始化时应跳过', async () => {
      // 当前状态已有 sftp
      await service.initializeSftpSession(sessionId);

      expect(mockSshClient.sftp).not.toHaveBeenCalled();
    });

    it('SFTP 初始化失败时应发送错误消息', async () => {
      const stateWithoutSftp = {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
        dbConnectionId: 1,
      };
      clientStates.set(sessionId, stateWithoutSftp);

      mockSshClient.sftp.mockImplementation((callback: any) => {
        callback(new Error('SFTP 初始化失败'));
      });

      await expect(service.initializeSftpSession(sessionId)).rejects.toThrow('SFTP 初始化失败');
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp_error'));
    });
  });

  describe('cleanupSftpSession', () => {
    it('应正确清理 SFTP 会话', () => {
      service.cleanupSftpSession(sessionId);

      expect(mockSftp.end).toHaveBeenCalled();
      expect(clientStates.get(sessionId)?.sftp).toBeUndefined();
    });

    it('无 SFTP 会话时应安全跳过', () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      expect(() => service.cleanupSftpSession(sessionId)).not.toThrow();
    });

    it('会话不存在时应安全跳过', () => {
      expect(() => service.cleanupSftpSession('non-existent')).not.toThrow();
    });
  });

  describe('readdir', () => {
    const testPath = '/home/user';

    it('应成功读取目录内容', async () => {
      const mockList: MockSftpDirEntry[] = [
        {
          filename: 'file1.txt',
          longname: '-rw-r--r-- 1 user user 1024 Dec 20 10:00 file1.txt',
          attrs: {
            size: 1024,
            uid: 1000,
            gid: 1000,
            mode: 0o644,
            atime: 1703059200,
            mtime: 1703059200,
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          },
        },
        {
          filename: 'subdir',
          longname: 'drwxr-xr-x 2 user user 4096 Dec 20 10:00 subdir',
          attrs: {
            size: 4096,
            uid: 1000,
            gid: 1000,
            mode: 0o755,
            atime: 1703059200,
            mtime: 1703059200,
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          },
        },
      ];

      mockSftp.readdir.mockImplementation((path: string, callback: any) => {
        callback(null, mockList);
      });

      await service.readdir(sessionId, testPath, requestId);

      expect(mockSftp.readdir).toHaveBeenCalledWith(testPath, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:readdir:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.readdir(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:readdir:error'));
    });

    it('读取失败时应发送错误消息', async () => {
      mockSftp.readdir.mockImplementation((path: string, callback: any) => {
        callback(new Error('Permission denied'));
      });

      await service.readdir(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:readdir:error'));
    });
  });

  describe('stat', () => {
    const testPath = '/home/user/file.txt';

    it('应成功获取文件状态', async () => {
      const mockStats: MockStats = {
        size: 2048,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });

      await service.stat(sessionId, testPath, requestId);

      expect(mockSftp.lstat).toHaveBeenCalledWith(testPath, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:stat:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.stat(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:stat:error'));
    });

    it('获取状态失败时应发送错误', async () => {
      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(new Error('No such file'));
      });

      await service.stat(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:stat:error'));
    });
  });

  describe('readFile', () => {
    const testPath = '/home/user/test.txt';

    it('应成功读取文件内容', async () => {
      const mockReadStream = new MockReadStream();
      const fileContent = 'Hello, World!';

      mockSftp.createReadStream.mockReturnValue(mockReadStream);

      const readPromise = service.readFile(sessionId, testPath, requestId);

      // 模拟数据流
      setTimeout(() => {
        mockReadStream.emit('data', Buffer.from(fileContent));
        mockReadStream.emit('end');
      }, 10);

      await readPromise;

      // 等待 setTimeout 中的异步事件触发
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockSftp.createReadStream).toHaveBeenCalledWith(testPath);
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:readfile:success'));
    });

    it('应使用指定的编码读取文件', async () => {
      const mockReadStream = new MockReadStream();

      mockSftp.createReadStream.mockReturnValue(mockReadStream);

      const readPromise = service.readFile(sessionId, testPath, requestId, 'gbk');

      setTimeout(() => {
        mockReadStream.emit('data', Buffer.from('中文内容'));
        mockReadStream.emit('end');
      }, 10);

      await readPromise;

      // 等待 setTimeout 中的异步事件触发
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(iconv.decode).toHaveBeenCalled();
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.readFile(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:readfile:error'));
    });

    it('读取流错误时应发送错误消息', async () => {
      const mockReadStream = new MockReadStream();

      mockSftp.createReadStream.mockReturnValue(mockReadStream);

      const readPromise = service.readFile(sessionId, testPath, requestId);

      setTimeout(() => {
        mockReadStream.emit('error', new Error('Read error'));
      }, 10);

      await readPromise;

      // 等待 setTimeout 中的异步事件触发
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:readfile:error'));
    });
  });

  describe('writefile', () => {
    const testPath = '/home/user/newfile.txt';
    const testContent = 'File content';

    it('应成功写入文件', async () => {
      const mockWriteStream = new MockWriteStream();
      const mockStats: MockStats = {
        size: testContent.length,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      const writePromise = service.writefile(sessionId, testPath, testContent, requestId);

      setTimeout(() => {
        mockWriteStream.emit('close');
      }, 10);

      await writePromise;

      expect(mockSftp.createWriteStream).toHaveBeenCalled();
    });

    it('应使用指定编码写入文件', async () => {
      const mockWriteStream = new MockWriteStream();
      const mockStats: MockStats = {
        size: 100,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      const writePromise = service.writefile(sessionId, testPath, '中文内容', requestId, 'gbk');

      setTimeout(() => {
        mockWriteStream.emit('close');
      }, 10);

      await writePromise;

      expect(iconv.encode).toHaveBeenCalledWith('中文内容', 'gbk');
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.writefile(sessionId, testPath, testContent, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:writefile:error'));
    });

    it('写入流错误时应发送错误消息', async () => {
      const mockWriteStream = new MockWriteStream();

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(new Error('Not found')); // 文件不存在，继续写入
      });
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      const writePromise = service.writefile(sessionId, testPath, testContent, requestId);

      setTimeout(() => {
        mockWriteStream.emit('error', new Error('Write error'));
      }, 10);

      await writePromise;

      // 等待 setTimeout 中的异步事件触发
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:writefile:error'));
    });
  });

  describe('mkdir', () => {
    const testPath = '/home/user/newdir';

    it('应成功创建目录', async () => {
      const mockStats: MockStats = {
        size: 4096,
        uid: 1000,
        gid: 1000,
        mode: 0o755,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      };

      mockSftp.mkdir.mockImplementation((path: string, callback: any) => {
        callback(null);
      });
      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });

      await service.mkdir(sessionId, testPath, requestId);

      expect(mockSftp.mkdir).toHaveBeenCalledWith(testPath, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:mkdir:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.mkdir(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:mkdir:error'));
    });

    it('创建目录失败时应发送错误', async () => {
      mockSftp.mkdir.mockImplementation((path: string, callback: any) => {
        callback(new Error('Directory already exists'));
      });

      await service.mkdir(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:mkdir:error'));
    });
  });

  describe('rmdir', () => {
    const testPath = '/home/user/olddir';

    it('应成功删除目录', async () => {
      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(null, mockStream);
        setTimeout(() => {
          mockStream.emit('close', 0, null);
        }, 10);
      });

      await service.rmdir(sessionId, testPath, requestId);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockSshClient.exec).toHaveBeenCalledWith(
        expect.stringContaining('rm -rf'),
        expect.any(Function)
      );
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:rmdir:success'));
    });

    it('SSH 客户端未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: null,
        sftp: mockSftp,
        ws: mockWs,
      });

      await service.rmdir(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:rmdir:error'));
    });

    it('删除失败时应发送错误', async () => {
      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(null, mockStream);
        setTimeout(() => {
          mockStream.stderr.emit('data', Buffer.from('Permission denied'));
          mockStream.emit('close', 1, null);
        }, 10);
      });

      await service.rmdir(sessionId, testPath, requestId);

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:rmdir:error'));
    });
  });

  describe('unlink', () => {
    const testPath = '/home/user/file.txt';

    it('应成功删除文件', async () => {
      mockSftp.unlink.mockImplementation((path: string, callback: any) => {
        callback(null);
      });

      await service.unlink(sessionId, testPath, requestId);

      expect(mockSftp.unlink).toHaveBeenCalledWith(testPath, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:unlink:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.unlink(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:unlink:error'));
    });

    it('删除失败时应发送错误', async () => {
      mockSftp.unlink.mockImplementation((path: string, callback: any) => {
        callback(new Error('No such file'));
      });

      await service.unlink(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:unlink:error'));
    });
  });

  describe('rename', () => {
    const oldPath = '/home/user/old.txt';
    const newPath = '/home/user/new.txt';

    it('应成功重命名文件', async () => {
      const mockStats: MockStats = {
        size: 1024,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      mockSftp.rename.mockImplementation((old: string, newP: string, callback: any) => {
        callback(null);
      });
      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });

      await service.rename(sessionId, oldPath, newPath, requestId);

      expect(mockSftp.rename).toHaveBeenCalledWith(oldPath, newPath, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:rename:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.rename(sessionId, oldPath, newPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:rename:error'));
    });

    it('重命名失败时应发送错误', async () => {
      mockSftp.rename.mockImplementation((old: string, newP: string, callback: any) => {
        callback(new Error('Permission denied'));
      });

      await service.rename(sessionId, oldPath, newPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:rename:error'));
    });
  });

  describe('chmod', () => {
    const testPath = '/home/user/file.txt';
    const newMode = 0o755;

    it('应成功修改权限', async () => {
      const mockStats: MockStats = {
        size: 1024,
        uid: 1000,
        gid: 1000,
        mode: newMode,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      mockSftp.chmod.mockImplementation((path: string, mode: number, callback: any) => {
        callback(null);
      });
      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });

      await service.chmod(sessionId, testPath, newMode, requestId);

      expect(mockSftp.chmod).toHaveBeenCalledWith(testPath, newMode, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:chmod:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.chmod(sessionId, testPath, newMode, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:chmod:error'));
    });

    it('修改权限失败时应发送错误', async () => {
      mockSftp.chmod.mockImplementation((path: string, mode: number, callback: any) => {
        callback(new Error('Operation not permitted'));
      });

      await service.chmod(sessionId, testPath, newMode, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:chmod:error'));
    });
  });

  describe('realpath', () => {
    const testPath = '~/Documents';
    const resolvedPath = '/home/user/Documents';

    it('应成功获取绝对路径', async () => {
      const mockStats: MockStats = {
        size: 4096,
        uid: 1000,
        gid: 1000,
        mode: 0o755,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      };

      mockSftp.realpath.mockImplementation((path: string, callback: any) => {
        callback(null, resolvedPath);
      });
      mockSftp.stat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });

      await service.realpath(sessionId, testPath, requestId);

      expect(mockSftp.realpath).toHaveBeenCalledWith(testPath, expect.any(Function));
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:realpath:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.realpath(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:realpath:error'));
    });

    it('路径解析失败时应发送错误', async () => {
      mockSftp.realpath.mockImplementation((path: string, callback: any) => {
        callback(new Error('No such file or directory'));
      });

      await service.realpath(sessionId, testPath, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:realpath:error'));
    });
  });

  describe('copy', () => {
    const sources = ['/home/user/file1.txt'];
    const destinationDir = '/home/user/backup';

    it('应成功复制文件', async () => {
      const mockStats: MockStats = {
        size: 1024,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      const mockReadStream = new MockReadStream();
      const mockWriteStream = new MockWriteStream();

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });
      mockSftp.createReadStream.mockReturnValue(mockReadStream);
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      const copyPromise = service.copy(sessionId, sources, destinationDir, requestId);

      setTimeout(() => {
        mockWriteStream.emit('close');
      }, 10);

      await copyPromise;

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:copy:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.copy(sessionId, sources, destinationDir, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:copy:error'));
    });

    it('源和目标相同时应跳过', async () => {
      const samePath = ['/home/user/backup/file.txt'];
      const mockStats: MockStats = {
        size: 4096,
        uid: 1000,
        gid: 1000,
        mode: 0o755,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      };

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats);
      });

      await service.copy(sessionId, samePath, '/home/user/backup', requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:copy:success'));
    });
  });

  describe('move', () => {
    const sources = ['/home/user/file1.txt'];
    const destinationDir = '/home/user/archive';

    it('应成功移动文件', async () => {
      const mockStats: MockStats = {
        size: 1024,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      // 第一次 lstat: 确保目标目录存在
      // 第二次 lstat: 检查目标文件不存在 (应抛出 ENOENT)
      // 第三次 lstat: 移动后获取状态
      let lstatCallCount = 0;
      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        lstatCallCount++;
        if (path.includes('archive/file1.txt') && lstatCallCount === 2) {
          // 目标文件不存在
          const err = new Error('No such file') as any;
          err.code = 'ENOENT';
          callback(err);
        } else {
          callback(null, mockStats);
        }
      });

      mockSftp.rename.mockImplementation((old: string, newP: string, callback: any) => {
        callback(null);
      });

      await service.move(sessionId, sources, destinationDir, requestId);

      expect(mockSftp.rename).toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:move:success'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.move(sessionId, sources, destinationDir, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:move:error'));
    });

    it('目标已存在时应发送错误', async () => {
      const mockStats: MockStats = {
        size: 1024,
        uid: 1000,
        gid: 1000,
        mode: 0o644,
        atime: 1703059200,
        mtime: 1703059200,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      };

      mockSftp.lstat.mockImplementation((path: string, callback: any) => {
        callback(null, mockStats); // 目标文件存在
      });

      await service.move(sessionId, sources, destinationDir, requestId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:move:error'));
    });
  });

  describe('compress', () => {
    const sources = ['/home/user/file.txt'];
    const destinationArchiveName = 'archive.zip';
    const targetDirectory = '/home/user';

    it('应成功压缩文件为 zip', async () => {
      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();

      // 模拟命令存在检查
      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(null, mockStream);
        setTimeout(() => {
          mockStream.emit('close', 0, null);
        }, 10);
      });

      await service.compress(sessionId, {
        sources,
        destinationArchiveName,
        format: 'zip',
        targetDirectory,
        requestId,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSshClient.exec).toHaveBeenCalled();
    });

    it('SSH 客户端未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: null,
        sftp: mockSftp,
        ws: mockWs,
      });

      await service.compress(sessionId, {
        sources,
        destinationArchiveName,
        format: 'zip',
        targetDirectory,
        requestId,
      });

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('SSH 会话未就绪'));
    });
  });

  describe('decompress', () => {
    const archivePath = '/home/user/archive.zip';

    it('应成功解压 zip 文件', async () => {
      const mockStream = new EventEmitter() as any;
      mockStream.stderr = new EventEmitter();

      mockSshClient.exec.mockImplementation((cmd: string, callback: any) => {
        callback(null, mockStream);
        setTimeout(() => {
          mockStream.emit('close', 0, null);
        }, 10);
      });

      await service.decompress(sessionId, {
        archivePath,
        requestId,
      });

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(mockSshClient.exec).toHaveBeenCalled();
    });

    it('不支持的格式应发送错误', async () => {
      await service.decompress(sessionId, {
        archivePath: '/home/user/file.unknown',
        requestId,
      });

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('不支持的压缩文件格式'));
    });

    it('SSH 客户端未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: null,
        sftp: mockSftp,
        ws: mockWs,
      });

      await service.decompress(sessionId, {
        archivePath,
        requestId,
      });

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('SSH 会话未就绪'));
    });
  });

  describe('startUpload', () => {
    const uploadId = 'upload-123';
    const remotePath = '/home/user/upload.txt';
    const totalSize = 1024;

    it('应成功开始上传', async () => {
      const mockWriteStream = new MockWriteStream();
      const openHandle = {};

      mockSftp.open.mockImplementation((path: string, flags: string, callback: any) => {
        callback(null, openHandle);
      });
      mockSftp.close.mockImplementation((handle: any, callback: any) => {
        callback(null);
      });
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      await service.startUpload(sessionId, uploadId, remotePath, totalSize);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:upload:ready'));
    });

    it('SFTP 未就绪时应发送错误', async () => {
      clientStates.set(sessionId, {
        sshClient: mockSshClient,
        sftp: undefined,
        ws: mockWs,
      });

      await service.startUpload(sessionId, uploadId, remotePath, totalSize);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:upload:error'));
    });

    it('文件不可写时应发送错误', async () => {
      mockSftp.open.mockImplementation((path: string, flags: string, callback: any) => {
        callback(new Error('Permission denied'));
      });

      await service.startUpload(sessionId, uploadId, remotePath, totalSize);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('sftp:upload:error'));
    });
  });

  describe('cancelUpload', () => {
    const uploadId = 'upload-123';

    it('无活动上传时应发送错误', () => {
      service.cancelUpload(sessionId, uploadId);

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('无效的上传 ID'));
    });

    it('会话不存在时应安全处理', () => {
      expect(() => service.cancelUpload('non-existent', uploadId)).not.toThrow();
    });
  });

  describe('边界条件', () => {
    it('会话不存在时各操作应安全处理', async () => {
      const nonExistentSession = 'non-existent-session';

      // readdir
      await service.readdir(nonExistentSession, '/path', requestId);
      // stat
      await service.stat(nonExistentSession, '/path', requestId);
      // readFile
      await service.readFile(nonExistentSession, '/path', requestId);
      // writefile
      await service.writefile(nonExistentSession, '/path', 'content', requestId);
      // mkdir
      await service.mkdir(nonExistentSession, '/path', requestId);
      // unlink
      await service.unlink(nonExistentSession, '/path', requestId);
      // rename
      await service.rename(nonExistentSession, '/old', '/new', requestId);
      // chmod
      await service.chmod(nonExistentSession, '/path', 0o755, requestId);
      // realpath
      await service.realpath(nonExistentSession, '/path', requestId);
      // copy
      await service.copy(nonExistentSession, ['/src'], '/dest', requestId);
      // move
      await service.move(nonExistentSession, ['/src'], '/dest', requestId);

      // 所有操作应不抛出异常
      expect(true).toBe(true);
    });
  });
});
