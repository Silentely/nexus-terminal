/**
 * Path History Service 单元测试
 * 测试路径历史管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  addPathHistory,
  getAllPathHistory,
  deletePathHistoryById,
  clearAllPathHistory,
} from './path-history.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const { mockRepository } = vi.hoisted(() => ({
  mockRepository: {
    upsertPath: vi.fn(),
    getAllPaths: vi.fn(),
    deletePathById: vi.fn(),
    clearAllPaths: vi.fn(),
  },
}));

// Mock 依赖模块
vi.mock('../path-history/path-history.repository', () => ({
  upsertPath: mockRepository.upsertPath,
  getAllPaths: mockRepository.getAllPaths,
  deletePathById: mockRepository.deletePathById,
  clearAllPaths: mockRepository.clearAllPaths,
}));

describe('PathHistoryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('addPathHistory', () => {
    it('应成功添加路径历史', async () => {
      mockRepository.upsertPath.mockResolvedValue(1);

      const result = await addPathHistory('/home/user/documents');

      expect(result).toBe(1);
      expect(mockRepository.upsertPath).toHaveBeenCalledWith('/home/user/documents');
    });

    it('应自动去除路径两端空白', async () => {
      mockRepository.upsertPath.mockResolvedValue(2);

      const result = await addPathHistory('  /var/log  ');

      expect(result).toBe(2);
      expect(mockRepository.upsertPath).toHaveBeenCalledWith('/var/log');
    });

    it('路径为空时应抛出错误', async () => {
      await expect(addPathHistory('')).rejects.toThrow('路径不能为空');
      expect(mockRepository.upsertPath).not.toHaveBeenCalled();
    });

    it('路径仅包含空白时应抛出错误', async () => {
      await expect(addPathHistory('   ')).rejects.toThrow('路径不能为空');
      expect(mockRepository.upsertPath).not.toHaveBeenCalled();
    });

    it('路径为 null/undefined 时应抛出错误', async () => {
      await expect(addPathHistory(null as any)).rejects.toThrow();
      await expect(addPathHistory(undefined as any)).rejects.toThrow();
      expect(mockRepository.upsertPath).not.toHaveBeenCalled();
    });

    it('repository 抛出错误时应正确传递', async () => {
      mockRepository.upsertPath.mockRejectedValue(new Error('Database error'));

      await expect(addPathHistory('/test/path')).rejects.toThrow('Database error');
    });
  });

  describe('getAllPathHistory', () => {
    it('应返回所有路径历史记录', async () => {
      const mockPaths = [
        { id: 1, path: '/home/user', timestamp: 1703000000 },
        { id: 2, path: '/var/log', timestamp: 1703000100 },
      ];
      mockRepository.getAllPaths.mockResolvedValue(mockPaths);

      const result = await getAllPathHistory();

      expect(result).toEqual(mockPaths);
      expect(mockRepository.getAllPaths).toHaveBeenCalledTimes(1);
    });

    it('无记录时应返回空数组', async () => {
      mockRepository.getAllPaths.mockResolvedValue([]);

      const result = await getAllPathHistory();

      expect(result).toEqual([]);
    });

    it('repository 抛出错误时应正确传递', async () => {
      mockRepository.getAllPaths.mockRejectedValue(new Error('Query failed'));

      await expect(getAllPathHistory()).rejects.toThrow('Query failed');
    });
  });

  describe('deletePathHistoryById', () => {
    it('成功删除时应返回 true', async () => {
      mockRepository.deletePathById.mockResolvedValue(true);

      const result = await deletePathHistoryById(1);

      expect(result).toBe(true);
      expect(mockRepository.deletePathById).toHaveBeenCalledWith(1);
    });

    it('记录不存在时应返回 false', async () => {
      mockRepository.deletePathById.mockResolvedValue(false);

      const result = await deletePathHistoryById(999);

      expect(result).toBe(false);
      expect(mockRepository.deletePathById).toHaveBeenCalledWith(999);
    });

    it('repository 抛出错误时应正确传递', async () => {
      mockRepository.deletePathById.mockRejectedValue(new Error('Delete failed'));

      await expect(deletePathHistoryById(1)).rejects.toThrow('Delete failed');
    });
  });

  describe('clearAllPathHistory', () => {
    it('应返回删除的记录条数', async () => {
      mockRepository.clearAllPaths.mockResolvedValue(10);

      const result = await clearAllPathHistory();

      expect(result).toBe(10);
      expect(mockRepository.clearAllPaths).toHaveBeenCalledTimes(1);
    });

    it('无记录时应返回 0', async () => {
      mockRepository.clearAllPaths.mockResolvedValue(0);

      const result = await clearAllPathHistory();

      expect(result).toBe(0);
    });

    it('repository 抛出错误时应正确传递', async () => {
      mockRepository.clearAllPaths.mockRejectedValue(new Error('Clear failed'));

      await expect(clearAllPathHistory()).rejects.toThrow('Clear failed');
    });
  });

  describe('边界条件', () => {
    it('应处理包含特殊字符的路径', async () => {
      mockRepository.upsertPath.mockResolvedValue(1);

      const specialPath = '/home/user/文件夹/测试 文件';
      await addPathHistory(specialPath);

      expect(mockRepository.upsertPath).toHaveBeenCalledWith(specialPath);
    });

    it('应处理非常长的路径', async () => {
      mockRepository.upsertPath.mockResolvedValue(1);

      const longPath = '/a'.repeat(500);
      await addPathHistory(longPath);

      expect(mockRepository.upsertPath).toHaveBeenCalledWith(longPath);
    });

    it('应处理根路径', async () => {
      mockRepository.upsertPath.mockResolvedValue(1);

      await addPathHistory('/');

      expect(mockRepository.upsertPath).toHaveBeenCalledWith('/');
    });

    it('应处理 Windows 风格路径', async () => {
      mockRepository.upsertPath.mockResolvedValue(1);

      await addPathHistory('C:\\Users\\Documents');

      expect(mockRepository.upsertPath).toHaveBeenCalledWith('C:\\Users\\Documents');
    });
  });
});
