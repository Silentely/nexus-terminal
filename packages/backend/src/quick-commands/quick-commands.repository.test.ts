/**
 * Quick Commands Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import {
  addQuickCommand,
  updateQuickCommand,
  deleteQuickCommand,
  getAllQuickCommands,
  incrementUsageCount,
  findQuickCommandById,
} from './quick-commands.repository';

describe('Quick Commands Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('addQuickCommand', () => {
    it('应成功添加快捷指令并返回 ID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });

      const result = await addQuickCommand('List Files', 'ls -la');

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO quick_commands');
      expect(call[2]).toContain('List Files');
      expect(call[2]).toContain('ls -la');
    });

    it('应支持带变量的快捷指令', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 6, changes: 1 });

      const variables = { path: '/home', user: 'root' };
      const result = await addQuickCommand('Custom Command', 'cd {{path}}', variables);

      expect(result).toBe(6);
      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBe(JSON.stringify(variables));
    });

    it('无变量时应存储 null', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 7, changes: 1 });

      await addQuickCommand('Simple', 'pwd');

      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBeNull();
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(addQuickCommand('Test', 'echo test')).rejects.toThrow('无法添加快捷指令');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(addQuickCommand('Test', 'test')).rejects.toThrow('无法添加快捷指令');
    });
  });

  describe('updateQuickCommand', () => {
    it('应成功更新快捷指令', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateQuickCommand(1, 'Updated Name', 'updated command');

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE quick_commands');
    });

    it('应支持更新变量', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const variables = { newVar: 'value' };
      await updateQuickCommand(1, 'Name', 'cmd', variables);

      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBe(JSON.stringify(variables));
    });

    it('指令不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateQuickCommand(999, 'Test', 'test');

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(updateQuickCommand(1, 'Test', 'test')).rejects.toThrow('无法更新快捷指令');
    });
  });

  describe('deleteQuickCommand', () => {
    it('应成功删除快捷指令', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteQuickCommand(1);

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM quick_commands WHERE id = ?');
    });

    it('指令不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteQuickCommand(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteQuickCommand(1)).rejects.toThrow('无法删除快捷指令');
    });
  });

  describe('getAllQuickCommands', () => {
    it('应返回所有快捷指令（默认按名称排序）', async () => {
      const mockRows = [
        {
          id: 1,
          name: 'Alpha',
          command: 'cmd1',
          usage_count: 5,
          variables: '{"key":"value"}',
          created_at: 1000,
          updated_at: 1000,
          tag_ids_str: '1,2',
        },
        {
          id: 2,
          name: 'Beta',
          command: 'cmd2',
          usage_count: 3,
          variables: null,
          created_at: 1001,
          updated_at: 1001,
          tag_ids_str: null,
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockRows);

      const result = await getAllQuickCommands();

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Alpha');
      expect(result[0].tagIds).toEqual([1, 2]);
      expect(result[0].variables).toEqual({ key: 'value' });
      expect(result[1].tagIds).toEqual([]);
      expect(result[1].variables).toBeNull();
    });

    it('应支持按使用频率排序', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      await getAllQuickCommands('usage_count');

      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('ORDER BY qc.usage_count DESC');
    });

    it('无指令时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await getAllQuickCommands();

      expect(result).toHaveLength(0);
    });

    it('应优雅处理 JSON 解析错误', async () => {
      const mockRows = [
        {
          id: 1,
          name: 'Test',
          command: 'cmd',
          usage_count: 0,
          variables: 'invalid json',
          created_at: 1000,
          updated_at: 1000,
          tag_ids_str: null,
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockRows);

      const result = await getAllQuickCommands();

      expect(result[0].variables).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(getAllQuickCommands()).rejects.toThrow('无法获取快捷指令');
    });
  });

  describe('incrementUsageCount', () => {
    it('应成功增加使用次数', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await incrementUsageCount(1);

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('usage_count = usage_count + 1');
    });

    it('指令不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await incrementUsageCount(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(incrementUsageCount(1)).rejects.toThrow('无法增加快捷指令使用次数');
    });
  });

  describe('findQuickCommandById', () => {
    it('应返回指定 ID 的快捷指令', async () => {
      const mockRow = {
        id: 1,
        name: 'Test Command',
        command: 'ls -la',
        usage_count: 10,
        variables: '{"path":"/home"}',
        created_at: 1000,
        updated_at: 1000,
        tag_ids_str: '1,3,5',
      };
      (getDb as any).mockResolvedValueOnce(mockRow);

      const result = await findQuickCommandById(1);

      expect(result).toBeDefined();
      expect(result?.id).toBe(1);
      expect(result?.tagIds).toEqual([1, 3, 5]);
      expect(result?.variables).toEqual({ path: '/home' });
    });

    it('指令不存在时应返回 undefined', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findQuickCommandById(999);

      expect(result).toBeUndefined();
    });

    it('应优雅处理 JSON 解析错误', async () => {
      const mockRow = {
        id: 1,
        name: 'Test',
        command: 'cmd',
        usage_count: 0,
        variables: 'bad json',
        created_at: 1000,
        updated_at: 1000,
        tag_ids_str: null,
      };
      (getDb as any).mockResolvedValueOnce(mockRow);

      const result = await findQuickCommandById(1);

      expect(result?.variables).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findQuickCommandById(1)).rejects.toThrow('无法查找快捷指令');
    });
  });
});
