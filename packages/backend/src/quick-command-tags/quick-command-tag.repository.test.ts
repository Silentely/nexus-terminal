/**
 * Quick Command Tag Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 数据库连接
const { mockPrepare } = vi.hoisted(() => {
  const mockPrepare = vi.fn().mockReturnValue({
    run: vi.fn().mockResolvedValue(undefined),
    finalize: vi.fn().mockResolvedValue(undefined),
  });
  return { mockPrepare };
});

vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({
    prepare: mockPrepare,
  }),
  runDb: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import {
  findAllQuickCommandTags,
  findQuickCommandTagById,
  createQuickCommandTag,
  updateQuickCommandTag,
  deleteQuickCommandTag,
  setCommandTagAssociations,
  addTagToCommands,
  findTagsByCommandId,
} from './quick-command-tag.repository';

describe('Quick Command Tag Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrepare.mockReturnValue({
      run: vi.fn().mockResolvedValue(undefined),
      finalize: vi.fn().mockResolvedValue(undefined),
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  const mockTag = {
    id: 1,
    name: 'DevOps',
    created_at: 1000,
    updated_at: 1000,
  };

  describe('findAllQuickCommandTags', () => {
    it('应返回所有快捷指令标签', async () => {
      (allDb as any).mockResolvedValueOnce([mockTag]);

      const result = await findAllQuickCommandTags();

      expect(result).toEqual([mockTag]);
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('SELECT * FROM quick_command_tags');
      expect(call[1]).toContain('ORDER BY name ASC');
    });

    it('无标签时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findAllQuickCommandTags();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllQuickCommandTags()).rejects.toThrow('获取快捷指令标签列表失败');
    });
  });

  describe('findQuickCommandTagById', () => {
    it('应返回指定 ID 的标签', async () => {
      (getDb as any).mockResolvedValueOnce(mockTag);

      const result = await findQuickCommandTagById(1);

      expect(result).toEqual(mockTag);
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('WHERE id = ?');
    });

    it('标签不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findQuickCommandTagById(999);

      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findQuickCommandTagById(1)).rejects.toThrow('获取快捷指令标签信息失败');
    });
  });

  describe('createQuickCommandTag', () => {
    it('应成功创建标签并返回 ID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });

      const result = await createQuickCommandTag('NewTag');

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO quick_command_tags');
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(createQuickCommandTag('Test')).rejects.toThrow(
        '创建快捷指令标签后未能获取有效的 lastID'
      );
    });

    it('名称重复时应抛出友好异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(createQuickCommandTag('Duplicate')).rejects.toThrow(
        '快捷指令标签名称 "Duplicate" 已存在。'
      );
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Some database error'));

      await expect(createQuickCommandTag('Test')).rejects.toThrow('创建快捷指令标签失败');
    });
  });

  describe('updateQuickCommandTag', () => {
    it('应成功更新标签名称', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateQuickCommandTag(1, 'UpdatedName');

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE quick_command_tags SET name');
    });

    it('标签不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateQuickCommandTag(999, 'Test');

      expect(result).toBe(false);
    });

    it('名称重复时应抛出友好异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(updateQuickCommandTag(1, 'Duplicate')).rejects.toThrow(
        '快捷指令标签名称 "Duplicate" 已存在。'
      );
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(updateQuickCommandTag(1, 'Test')).rejects.toThrow('更新快捷指令标签失败');
    });
  });

  describe('deleteQuickCommandTag', () => {
    it('应成功删除标签', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteQuickCommandTag(1);

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM quick_command_tags WHERE id = ?');
    });

    it('标签不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteQuickCommandTag(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteQuickCommandTag(1)).rejects.toThrow('删除快捷指令标签失败');
    });
  });

  describe('setCommandTagAssociations', () => {
    it('应成功设置标签关联（使用事务）', async () => {
      (runDb as any).mockResolvedValue({ changes: 1 });

      await expect(setCommandTagAssociations(1, [1, 2, 3])).resolves.toBeUndefined();

      // 应调用 BEGIN TRANSACTION
      expect(runDb).toHaveBeenCalledWith(expect.anything(), 'BEGIN TRANSACTION');
      // 应调用 COMMIT
      expect(runDb).toHaveBeenCalledWith(expect.anything(), 'COMMIT');
    });

    it('空标签列表应清除所有关联', async () => {
      (runDb as any).mockResolvedValue({ changes: 1 });

      await setCommandTagAssociations(1, []);

      // 应执行 DELETE 但不执行 INSERT
      const deleteCalls = (runDb as any).mock.calls.filter((call: any[]) =>
        call[1]?.includes?.('DELETE')
      );
      expect(deleteCalls.length).toBeGreaterThan(0);
    });

    it('事务失败时应回滚', async () => {
      (runDb as any)
        .mockResolvedValueOnce({ changes: 1 }) // BEGIN
        .mockResolvedValueOnce({ changes: 1 }) // DELETE
        .mockRejectedValueOnce(new Error('Insert failed')) // INSERT 失败
        .mockResolvedValueOnce({ changes: 1 }); // ROLLBACK

      await expect(setCommandTagAssociations(1, [1])).rejects.toThrow('无法设置快捷指令标签关联');
    });
  });

  describe('addTagToCommands', () => {
    it('应成功批量添加标签关联', async () => {
      (runDb as any).mockResolvedValue({ changes: 1 });

      await expect(addTagToCommands([1, 2, 3], 5)).resolves.toBeUndefined();

      expect(runDb).toHaveBeenCalledWith(expect.anything(), 'BEGIN TRANSACTION');
      expect(runDb).toHaveBeenCalledWith(expect.anything(), 'COMMIT');
    });

    it('空指令列表应直接返回', async () => {
      await addTagToCommands([], 5);

      expect(runDb).not.toHaveBeenCalled();
    });

    it('事务失败时应回滚', async () => {
      (runDb as any)
        .mockResolvedValueOnce({ changes: 1 })
        .mockRejectedValueOnce(new Error('Failed'));

      await expect(addTagToCommands([1], 5)).rejects.toThrow('无法批量关联标签到快捷指令');
    });
  });

  describe('findTagsByCommandId', () => {
    it('应返回指定指令的所有标签', async () => {
      (allDb as any).mockResolvedValueOnce([mockTag]);

      const result = await findTagsByCommandId(1);

      expect(result).toEqual([mockTag]);
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('JOIN quick_command_tag_associations');
      expect(call[1]).toContain('WHERE ta.quick_command_id = ?');
    });

    it('指令无标签时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findTagsByCommandId(999);

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findTagsByCommandId(1)).rejects.toThrow('获取快捷指令标签失败');
    });
  });
});
