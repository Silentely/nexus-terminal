/**
 * Temporary Log Storage Service 单元测试
 * 测试临时日志文件存储的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { TemporaryLogStorageService } from './temporary-log-storage.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const mockFs = vi.hoisted(() => ({
  mkdir: vi.fn(),
  stat: vi.fn(),
  writeFile: vi.fn(),
  appendFile: vi.fn(),
  readFile: vi.fn(),
  unlink: vi.fn(),
  readdir: vi.fn(),
}));

// Mock 依赖模块
vi.mock('fs/promises', () => ({
  mkdir: mockFs.mkdir,
  stat: mockFs.stat,
  writeFile: mockFs.writeFile,
  appendFile: mockFs.appendFile,
  readFile: mockFs.readFile,
  unlink: mockFs.unlink,
  readdir: mockFs.readdir,
  default: mockFs,
}));

// path 模块使用真实实现但可以监控
vi.mock('path', async () => {
  const actual = await vi.importActual<typeof import('path')>('path');
  return {
    ...actual,
    default: actual,
  };
});

describe('TemporaryLogStorageService', () => {
  let service: TemporaryLogStorageService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.mkdir.mockResolvedValue(undefined);
    // 创建新实例（构造函数会调用 ensureLogDirectoryExists）
    service = new TemporaryLogStorageService();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('ensureLogDirectoryExists', () => {
    it('应创建日志目录', async () => {
      mockFs.mkdir.mockResolvedValue(undefined);

      await service.ensureLogDirectoryExists();

      expect(mockFs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining('temp_suspended_ssh_logs'),
        { recursive: true }
      );
    });

    it('创建目录失败时应记录错误但不抛出', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFs.mkdir.mockRejectedValue(new Error('Permission denied'));

      await service.ensureLogDirectoryExists();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('创建日志目录'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('writeToLog', () => {
    it('应追加数据到日志文件', async () => {
      mockFs.stat.mockRejectedValue({ code: 'ENOENT' }); // 文件不存在
      mockFs.appendFile.mockResolvedValue(undefined);

      await service.writeToLog('session-123', 'test log data');

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('session-123.log'),
        'test log data',
        'utf8'
      );
    });

    it('文件超过最大大小时应执行轮替（清空重写）', async () => {
      // 模拟文件大小达到 100MB
      mockFs.stat.mockResolvedValue({ size: 100 * 1024 * 1024 });
      mockFs.writeFile.mockResolvedValue(undefined);

      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await service.writeToLog('session-456', 'new data after rotation');

      expect(mockFs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('session-456.log'),
        'new data after rotation',
        'utf8'
      );
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('执行轮替'));
      consoleSpy.mockRestore();
    });

    it('文件未达最大大小时应追加写入', async () => {
      mockFs.stat.mockResolvedValue({ size: 1024 }); // 1KB
      mockFs.appendFile.mockResolvedValue(undefined);

      await service.writeToLog('session-789', 'append data');

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('session-789.log'),
        'append data',
        'utf8'
      );
      expect(mockFs.writeFile).not.toHaveBeenCalled();
    });

    it('写入失败时应抛出错误', async () => {
      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });
      mockFs.appendFile.mockRejectedValue(new Error('Disk full'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.writeToLog('session-err', 'data')).rejects.toThrow('Disk full');

      consoleSpy.mockRestore();
    });

    it('stat 返回非 ENOENT 错误时应抛出', async () => {
      mockFs.stat.mockRejectedValue(new Error('Unknown error'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.writeToLog('session-unknown', 'data')).rejects.toThrow('Unknown error');

      consoleSpy.mockRestore();
    });
  });

  describe('readLog', () => {
    it('应读取日志文件内容', async () => {
      mockFs.readFile.mockResolvedValue('log content line 1\nlog content line 2');

      const result = await service.readLog('session-read');

      expect(result).toBe('log content line 1\nlog content line 2');
      expect(mockFs.readFile).toHaveBeenCalledWith(
        expect.stringContaining('session-read.log'),
        'utf8'
      );
    });

    it('文件不存在时应返回空字符串', async () => {
      mockFs.readFile.mockRejectedValue({ code: 'ENOENT' });

      const result = await service.readLog('session-nonexist');

      expect(result).toBe('');
    });

    it('读取失败（非 ENOENT）时应抛出错误', async () => {
      mockFs.readFile.mockRejectedValue(new Error('Read permission denied'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.readLog('session-noperm')).rejects.toThrow('Read permission denied');

      consoleSpy.mockRestore();
    });
  });

  describe('deleteLog', () => {
    it('应删除日志文件', async () => {
      mockFs.unlink.mockResolvedValue(undefined);

      await service.deleteLog('session-delete');

      expect(mockFs.unlink).toHaveBeenCalledWith(expect.stringContaining('session-delete.log'));
    });

    it('文件不存在时应静默返回', async () => {
      mockFs.unlink.mockRejectedValue({ code: 'ENOENT' });

      // 不应抛出错误
      await expect(service.deleteLog('session-gone')).resolves.toBeUndefined();
    });

    it('删除失败（非 ENOENT）时应抛出错误', async () => {
      mockFs.unlink.mockRejectedValue(new Error('Delete permission denied'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.deleteLog('session-locked')).rejects.toThrow('Delete permission denied');

      consoleSpy.mockRestore();
    });
  });

  describe('listLogFiles', () => {
    it('应返回所有日志文件的 sessionId', async () => {
      mockFs.readdir.mockResolvedValue(['session-1.log', 'session-2.log', 'other-file.txt']);

      const result = await service.listLogFiles();

      expect(result).toEqual(['session-1', 'session-2']);
    });

    it('目录为空时应返回空数组', async () => {
      mockFs.readdir.mockResolvedValue([]);

      const result = await service.listLogFiles();

      expect(result).toEqual([]);
    });

    it('读取目录失败时应返回空数组', async () => {
      mockFs.readdir.mockRejectedValue(new Error('Directory not found'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const result = await service.listLogFiles();

      expect(result).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('应过滤非 .log 文件', async () => {
      mockFs.readdir.mockResolvedValue(['a.log', 'b.txt', 'c.log', '.log', 'test']);

      const result = await service.listLogFiles();

      expect(result).toEqual(['a', 'c', '']);
    });
  });

  describe('边界条件', () => {
    it('应处理包含特殊字符的 sessionId', async () => {
      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });
      mockFs.appendFile.mockResolvedValue(undefined);

      await service.writeToLog('session-with-特殊字符-123', 'data');

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('session-with-特殊字符-123.log'),
        'data',
        'utf8'
      );
    });

    it('应处理空数据写入', async () => {
      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });
      mockFs.appendFile.mockResolvedValue(undefined);

      await service.writeToLog('session-empty', '');

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining('session-empty.log'),
        '',
        'utf8'
      );
    });

    it('应处理非常长的 sessionId', async () => {
      mockFs.stat.mockRejectedValue({ code: 'ENOENT' });
      mockFs.appendFile.mockResolvedValue(undefined);

      const longId = 'a'.repeat(500);
      await service.writeToLog(longId, 'data');

      expect(mockFs.appendFile).toHaveBeenCalledWith(
        expect.stringContaining(`${longId}.log`),
        'data',
        'utf8'
      );
    });
  });
});
