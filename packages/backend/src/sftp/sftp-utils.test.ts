/**
 * SFTP 工具函数单元测试
 * 测试 SftpUtils 类的 Promise 包装和辅助方法
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SftpUtils } from './sftp-utils';
import type { Stats } from 'ssh2';

// 创建 mock Stats 对象
function createMockStats(overrides: Partial<Stats> = {}): Stats {
  return {
    mode: 33188,
    uid: 1000,
    gid: 1000,
    size: 1024,
    atime: 1700000000,
    mtime: 1700000000,
    isDirectory: () => false,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  } as Stats;
}

describe('SftpUtils', () => {
  let mockSftp: {
    lstat: ReturnType<typeof vi.fn>;
    readdir: ReturnType<typeof vi.fn>;
    rename: ReturnType<typeof vi.fn>;
    mkdir: ReturnType<typeof vi.fn>;
    createReadStream: ReturnType<typeof vi.fn>;
    createWriteStream: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSftp = {
      lstat: vi.fn(),
      readdir: vi.fn(),
      rename: vi.fn(),
      mkdir: vi.fn(),
      createReadStream: vi.fn(),
      createWriteStream: vi.fn(),
    };
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getStats', () => {
    it('应成功获取文件状态', async () => {
      const mockStats = createMockStats();
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(null, mockStats),
      );

      const result = await SftpUtils.getStats(mockSftp, '/test/file.txt');

      expect(result).toEqual(mockStats);
      expect(mockSftp.lstat).toHaveBeenCalledWith('/test/file.txt', expect.any(Function));
    });

    it('应拒绝并抛出错误当 lstat 失败', async () => {
      const error = new Error('No such file');
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(error, null),
      );

      await expect(SftpUtils.getStats(mockSftp, '/nonexistent')).rejects.toThrow('No such file');
    });
  });

  describe('listDirectory', () => {
    it('应成功列出目录内容', async () => {
      const mockList = [
        { filename: 'file1.txt', longname: '-rw-r--r--', attrs: createMockStats() },
        {
          filename: 'dir1',
          longname: 'drwxr-xr-x',
          attrs: createMockStats({ isDirectory: () => true, isFile: () => false }),
        },
      ];
      mockSftp.readdir.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(null, mockList),
      );

      const result = await SftpUtils.listDirectory(mockSftp, '/test');

      expect(result).toEqual(mockList);
      expect(result).toHaveLength(2);
    });

    it('应拒绝并抛出错误当 readdir 失败', async () => {
      const error = new Error('Permission denied');
      mockSftp.readdir.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(error, null),
      );

      await expect(SftpUtils.listDirectory(mockSftp, '/test')).rejects.toThrow('Permission denied');
    });
  });

  describe('performRename', () => {
    it('应成功执行重命名', async () => {
      mockSftp.rename.mockImplementation(
        (_old: string, _new: string, cb: (...args: unknown[]) => void) => cb(null),
      );

      await SftpUtils.performRename(mockSftp, '/old/path', '/new/path');

      expect(mockSftp.rename).toHaveBeenCalledWith('/old/path', '/new/path', expect.any(Function));
    });

    it('应拒绝并抛出错误当重命名失败', async () => {
      const error = new Error('Device busy');
      mockSftp.rename.mockImplementation(
        (_old: string, _new: string, cb: (...args: unknown[]) => void) => cb(error),
      );

      await expect(SftpUtils.performRename(mockSftp, '/old/path', '/new/path')).rejects.toThrow(
        'Device busy',
      );
    });
  });

  describe('formatStatsToFileListItem', () => {
    it('应正确格式化文件信息', () => {
      const stats = createMockStats({
        size: 2048,
        uid: 501,
        gid: 20,
        mode: 33188,
        atime: 1700000000,
        mtime: 1700000100,
        isDirectory: () => false,
        isFile: () => true,
        isSymbolicLink: () => false,
      });

      const result = SftpUtils.formatStatsToFileListItem('/test/file.txt', stats);

      expect(result.filename).toBe('file.txt');
      expect(result.longname).toBe('');
      expect(result.attrs.size).toBe(2048);
      expect(result.attrs.uid).toBe(501);
      expect(result.attrs.gid).toBe(20);
      expect(result.attrs.mode).toBe(33188);
      expect(result.attrs.atime).toBe(1700000000000);
      expect(result.attrs.mtime).toBe(1700000100000);
      expect(result.attrs.isDirectory).toBe(false);
      expect(result.attrs.isFile).toBe(true);
      expect(result.attrs.isSymbolicLink).toBe(false);
    });

    it('应正确处理目录类型', () => {
      const stats = createMockStats({
        isDirectory: () => true,
        isFile: () => false,
        isSymbolicLink: () => false,
      });

      const result = SftpUtils.formatStatsToFileListItem('/test/mydir', stats);

      expect(result.filename).toBe('mydir');
      expect(result.attrs.isDirectory).toBe(true);
      expect(result.attrs.isFile).toBe(false);
    });

    it('应正确处理符号链接类型', () => {
      const stats = createMockStats({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
      });

      const result = SftpUtils.formatStatsToFileListItem('/test/link', stats);

      expect(result.filename).toBe('link');
      expect(result.attrs.isSymbolicLink).toBe(true);
    });
  });

  describe('ensureDirectoryExists', () => {
    it('应跳过空路径和根路径', async () => {
      await SftpUtils.ensureDirectoryExists(mockSftp, '');
      await SftpUtils.ensureDirectoryExists(mockSftp, '/');
      expect(mockSftp.lstat).not.toHaveBeenCalled();
    });

    it('应跳过以斜杠结尾的空路径', async () => {
      await SftpUtils.ensureDirectoryExists(mockSftp, '/');
      expect(mockSftp.lstat).not.toHaveBeenCalled();
    });

    it('目录已存在时应直接返回', async () => {
      const mockStats = createMockStats({ isDirectory: () => true });
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(null, mockStats),
      );

      await SftpUtils.ensureDirectoryExists(mockSftp, '/existing/dir');

      expect(mockSftp.lstat).toHaveBeenCalledWith('/existing/dir', expect.any(Function));
      expect(mockSftp.mkdir).not.toHaveBeenCalled();
    });

    it('目录不存在时应尝试创建（使用 recursive mkdir）', async () => {
      const enoentError = Object.assign(new Error('No such file'), { code: 'ENOENT' });

      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(enoentError, null),
      );
      mockSftp.mkdir.mockImplementation(
        (_path: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
          if (typeof _opts === 'function') {
            _opts(null);
          } else {
            cb(null);
          }
        },
      );

      await SftpUtils.ensureDirectoryExists(mockSftp, '/new/dir');

      expect(mockSftp.mkdir).toHaveBeenCalled();
    });

    it('recursive mkdir 失败时应回退到逐级创建', async () => {
      const enoentError = Object.assign(new Error('No such file'), { code: 'ENOENT' });
      const mkdirError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });

      let callCount = 0;
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) => {
        cb(enoentError, null);
      });

      // 第一次 mkdir（recursive）失败，第二次 mkdir（非 recursive）成功
      mockSftp.mkdir.mockImplementation(
        (_path: string, _optsOrCb: unknown, cbOrUndefined?: (...args: unknown[]) => void) => {
          callCount++;
          if (callCount === 1) {
            // recursive mkdir 失败
            if (typeof _optsOrCb === 'function') {
              _optsOrCb(mkdirError);
            } else {
              cbOrUndefined?.(mkdirError);
            }
          } else {
            // 非 recursive mkdir 成功
            const cb = typeof _optsOrCb === 'function' ? _optsOrCb : cbOrUndefined;
            cb?.(null);
          }
        },
      );

      await SftpUtils.ensureDirectoryExists(mockSftp, '/parent/child');

      expect(mockSftp.mkdir).toHaveBeenCalled();
    });

    it('stat 错误不是 ENOENT 时应抛出异常', async () => {
      const permError = Object.assign(new Error('Permission denied'), { code: 'EACCES' });

      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(permError, null),
      );

      await expect(SftpUtils.ensureDirectoryExists(mockSftp, '/restricted')).rejects.toThrow(
        '检查目录失败 /restricted',
      );
    });

    it('stat 错误消息包含 No such file 时应尝试创建目录', async () => {
      const error = new Error('No such file or directory');
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(error, null),
      );
      mockSftp.mkdir.mockImplementation(
        (_path: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
          if (typeof _opts === 'function') {
            _opts(null);
          } else {
            cb(null);
          }
        },
      );

      await SftpUtils.ensureDirectoryExists(mockSftp, '/missing/path');

      expect(mockSftp.mkdir).toHaveBeenCalled();
    });
  });

  describe('copyFile', () => {
    it('应成功复制文件', async () => {
      const mockReadStream = {
        on: vi.fn(),
        destroy: vi.fn(),
        pipe: vi.fn(),
      };
      const mockWriteStream = {
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockSftp.createReadStream.mockReturnValue(mockReadStream);
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      // 模拟 pipe 后触发 close 事件
      mockReadStream.pipe.mockImplementation(() => {
        // 模拟 pipe 完成后触发 writeStream 的 close 事件
        const closeCallback = mockWriteStream.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'close',
        )?.[1];
        if (closeCallback) closeCallback();
      });

      const result = SftpUtils.copyFile(mockSftp, '/source/file.txt', '/dest/file.txt');

      expect(mockSftp.createReadStream).toHaveBeenCalledWith('/source/file.txt');
      expect(mockSftp.createWriteStream).toHaveBeenCalledWith('/dest/file.txt');
      expect(mockReadStream.pipe).toHaveBeenCalledWith(mockWriteStream);

      await expect(result).resolves.toBeUndefined();
    });

    it('应处理读取流错误', async () => {
      const mockReadStream = {
        on: vi.fn(),
        destroy: vi.fn(),
        pipe: vi.fn(),
      };
      const mockWriteStream = {
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockSftp.createReadStream.mockReturnValue(mockReadStream);
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      // 模拟 readStream error 事件
      mockReadStream.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          // 立即触发错误
          setTimeout(() => cb(new Error('Read failed')), 0);
        }
      });

      await expect(
        SftpUtils.copyFile(mockSftp, '/source/file.txt', '/dest/file.txt'),
      ).rejects.toThrow('复制文件失败: Read failed');
    });

    it('应处理写入流错误', async () => {
      const mockReadStream = {
        on: vi.fn(),
        destroy: vi.fn(),
        pipe: vi.fn(),
      };
      const mockWriteStream = {
        on: vi.fn(),
        destroy: vi.fn(),
      };

      mockSftp.createReadStream.mockReturnValue(mockReadStream);
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      // 模拟 writeStream error 事件
      mockWriteStream.on.mockImplementation((event: string, cb: (...args: unknown[]) => void) => {
        if (event === 'error') {
          setTimeout(() => cb(new Error('Write failed')), 0);
        }
      });

      await expect(
        SftpUtils.copyFile(mockSftp, '/source/file.txt', '/dest/file.txt'),
      ).rejects.toThrow('复制文件失败: Write failed');
    });
  });

  describe('copyDirectoryRecursive', () => {
    it('应递归复制目录中的文件', async () => {
      const mockDirStats = createMockStats({ isDirectory: () => true, isFile: () => false });
      const mockFileStats = createMockStats({ isDirectory: () => false, isFile: () => true });

      // ensureDirectoryExists: dest 路径不存在（ENOENT），需要 mkdir
      const enoentError = Object.assign(new Error('No such file'), { code: 'ENOENT' });

      let _lstatCallCount = 0;
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) => {
        _lstatCallCount++;
        if (_path === '/dest') {
          // dest 不存在，触发创建
          cb(enoentError, null);
        } else {
          // 源目录存在
          cb(null, mockDirStats);
        }
      });

      // mkdir 成功
      mockSftp.mkdir.mockImplementation(
        (_path: string, _opts: unknown, cb: (...args: unknown[]) => void) => {
          if (typeof _opts === 'function') {
            _opts(null);
          } else {
            cb(null);
          }
        },
      );

      // listDirectory 返回一个文件
      const mockList = [{ filename: 'file.txt', longname: '-rw-r--r--', attrs: mockFileStats }];
      mockSftp.readdir.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(null, mockList),
      );

      // copyFile 的 mock
      const mockReadStream = {
        on: vi.fn(),
        destroy: vi.fn(),
        pipe: vi.fn(),
      };
      const mockWriteStream = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'close') {
            setTimeout(() => cb(), 0);
          }
        }),
        destroy: vi.fn(),
      };
      mockSftp.createReadStream.mockReturnValue(mockReadStream);
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);

      mockReadStream.pipe.mockImplementation(() => {
        const closeCallback = mockWriteStream.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'close',
        )?.[1];
        if (closeCallback) closeCallback();
      });

      await SftpUtils.copyDirectoryRecursive(mockSftp, '/source', '/dest');

      expect(mockSftp.mkdir).toHaveBeenCalled();
      expect(mockSftp.readdir).toHaveBeenCalled();
      expect(mockSftp.createReadStream).toHaveBeenCalled();
    });

    it('应递归处理子目录', async () => {
      const mockDirStats = createMockStats({ isDirectory: () => true, isFile: () => false });
      const mockFileStats = createMockStats({ isDirectory: () => false, isFile: () => true });

      let readdirCallCount = 0;
      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(null, mockDirStats),
      );

      mockSftp.readdir.mockImplementation((_path: string, cb: (...args: unknown[]) => void) => {
        readdirCallCount++;
        if (readdirCallCount === 1) {
          // 父目录：包含子目录
          cb(null, [{ filename: 'subdir', longname: 'drwxr-xr-x', attrs: mockDirStats }]);
        } else {
          // 子目录：包含文件
          cb(null, [{ filename: 'inner.txt', longname: '-rw-r--r--', attrs: mockFileStats }]);
        }
      });

      const mockReadStream = {
        on: vi.fn(),
        destroy: vi.fn(),
        pipe: vi.fn(),
      };
      const mockWriteStream = {
        on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
          if (event === 'close') setTimeout(() => cb(), 0);
        }),
        destroy: vi.fn(),
      };
      mockSftp.createReadStream.mockReturnValue(mockReadStream);
      mockSftp.createWriteStream.mockReturnValue(mockWriteStream);
      mockReadStream.pipe.mockImplementation(() => {
        const closeCallback = mockWriteStream.on.mock.calls.find(
          (call: unknown[]) => call[0] === 'close',
        )?.[1];
        if (closeCallback) closeCallback();
      });

      await SftpUtils.copyDirectoryRecursive(mockSftp, '/source', '/dest');

      // 应该被调用两次：父目录和子目录
      expect(mockSftp.readdir).toHaveBeenCalledTimes(2);
    });

    it('应跳过符号链接', async () => {
      const mockDirStats = createMockStats({ isDirectory: () => true, isFile: () => false });
      const mockLinkStats = createMockStats({
        isDirectory: () => false,
        isFile: () => false,
        isSymbolicLink: () => true,
      });

      mockSftp.lstat.mockImplementation((_path: string, cb: (...args: unknown[]) => void) =>
        cb(null, mockDirStats),
      );
      mockSftp.readdir.mockImplementation((_path: string, cb: (...args: unknown[]) => void) => {
        cb(null, [{ filename: 'link', longname: 'lrwxrwxrwx', attrs: mockLinkStats }]);
      });

      await SftpUtils.copyDirectoryRecursive(mockSftp, '/source', '/dest');

      expect(mockSftp.createReadStream).not.toHaveBeenCalled();
    });
  });
});
