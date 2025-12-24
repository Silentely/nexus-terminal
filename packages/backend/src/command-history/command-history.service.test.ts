/**
 * Command History Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as CommandHistoryRepository from './command-history.repository';
import {
  addCommandHistory,
  getAllCommandHistory,
  deleteCommandHistoryById,
  clearAllCommandHistory,
} from './command-history.service';

// Mock Command History Repository
vi.mock('./command-history.repository', () => ({
  upsertCommand: vi.fn(),
  getAllCommands: vi.fn(),
  deleteCommandById: vi.fn(),
  clearAllCommands: vi.fn(),
}));

describe('Command History Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('addCommandHistory', () => {
    it('应成功添加命令历史记录', async () => {
      (CommandHistoryRepository.upsertCommand as any).mockResolvedValueOnce(5);

      const result = await addCommandHistory('ls -la');

      expect(result).toBe(5);
      expect(CommandHistoryRepository.upsertCommand).toHaveBeenCalledWith('ls -la');
    });

    it('应对命令进行 trim 处理', async () => {
      (CommandHistoryRepository.upsertCommand as any).mockResolvedValueOnce(6);

      await addCommandHistory('  echo hello  ');

      expect(CommandHistoryRepository.upsertCommand).toHaveBeenCalledWith('echo hello');
    });

    it('空命令应抛出异常', async () => {
      await expect(addCommandHistory('')).rejects.toThrow('命令不能为空');
    });

    it('仅空白字符的命令应抛出异常', async () => {
      await expect(addCommandHistory('   ')).rejects.toThrow('命令不能为空');
    });
  });

  describe('getAllCommandHistory', () => {
    it('应返回所有命令历史记录', async () => {
      const mockCommands = [
        { id: 1, command: 'ls', timestamp: 1000 },
        { id: 2, command: 'pwd', timestamp: 2000 },
      ];
      (CommandHistoryRepository.getAllCommands as any).mockResolvedValueOnce(mockCommands);

      const result = await getAllCommandHistory();

      expect(result).toEqual(mockCommands);
      expect(CommandHistoryRepository.getAllCommands).toHaveBeenCalled();
    });
  });

  describe('deleteCommandHistoryById', () => {
    it('应成功删除命令历史记录', async () => {
      (CommandHistoryRepository.deleteCommandById as any).mockResolvedValueOnce(true);

      const result = await deleteCommandHistoryById(1);

      expect(result).toBe(true);
      expect(CommandHistoryRepository.deleteCommandById).toHaveBeenCalledWith(1);
    });

    it('记录不存在时应返回 false', async () => {
      (CommandHistoryRepository.deleteCommandById as any).mockResolvedValueOnce(false);

      const result = await deleteCommandHistoryById(999);

      expect(result).toBe(false);
    });
  });

  describe('clearAllCommandHistory', () => {
    it('应成功清空所有命令历史记录并返回删除数量', async () => {
      (CommandHistoryRepository.clearAllCommands as any).mockResolvedValueOnce(100);

      const result = await clearAllCommandHistory();

      expect(result).toBe(100);
      expect(CommandHistoryRepository.clearAllCommands).toHaveBeenCalled();
    });
  });
});
