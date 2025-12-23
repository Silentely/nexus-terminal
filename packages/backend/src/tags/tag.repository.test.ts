/**
 * Tag Repository 单元测试
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
  findAllTags,
  findTagById,
  createTag,
  updateTag,
  deleteTag,
  updateTagConnections,
} from './tag.repository';

describe('Tag Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('findAllTags', () => {
    it('应返回所有标签列表', async () => {
      const mockTags = [
        { id: 1, name: 'Production', created_at: 1000, updated_at: 1000 },
        { id: 2, name: 'Development', created_at: 1001, updated_at: 1001 },
      ];
      (allDb as any).mockResolvedValueOnce(mockTags);

      const result = await findAllTags();

      expect(result).toEqual(mockTags);
      expect(allDb).toHaveBeenCalled();
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('ORDER BY name ASC');
    });

    it('无标签时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findAllTags();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllTags()).rejects.toThrow('获取标签列表失败');
    });
  });

  describe('findTagById', () => {
    it('应返回指定 ID 的标签', async () => {
      const mockTag = { id: 1, name: 'Production', created_at: 1000, updated_at: 1000 };
      (getDb as any).mockResolvedValueOnce(mockTag);

      const result = await findTagById(1);

      expect(result).toEqual(mockTag);
      expect(getDb).toHaveBeenCalled();
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('WHERE id = ?');
      expect(call[2]).toContain(1);
    });

    it('标签不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findTagById(999);

      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findTagById(1)).rejects.toThrow('获取标签信息失败');
    });
  });

  describe('createTag', () => {
    it('应成功创建标签并返回 ID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });

      const result = await createTag('New Tag');

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO tags');
      expect(call[2][0]).toBe('New Tag');
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(createTag('Test')).rejects.toThrow('创建标签后未能获取有效的 lastID');
    });

    it('标签名称重复时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(createTag('Duplicate')).rejects.toThrow('标签名称 "Duplicate" 已存在');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Some database error'));

      await expect(createTag('Test')).rejects.toThrow('创建标签失败');
    });
  });

  describe('updateTag', () => {
    it('应成功更新标签名称', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateTag(1, 'Updated Name');

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE tags SET name = ?');
      expect(call[2][0]).toBe('Updated Name');
    });

    it('标签不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateTag(999, 'Test');

      expect(result).toBe(false);
    });

    it('标签名称重复时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(updateTag(1, 'Duplicate')).rejects.toThrow('标签名称 "Duplicate" 已存在');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(updateTag(1, 'Test')).rejects.toThrow('更新标签失败');
    });
  });

  describe('deleteTag', () => {
    it('应成功删除标签', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteTag(1);

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM tags WHERE id = ?');
    });

    it('标签不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteTag(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteTag(1)).rejects.toThrow('删除标签失败');
    });
  });

  describe('updateTagConnections', () => {
    it('应成功更新标签关联的连接', async () => {
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN TRANSACTION
        .mockResolvedValueOnce({}) // DELETE
        .mockResolvedValueOnce({}) // INSERT connection 1
        .mockResolvedValueOnce({}) // INSERT connection 2
        .mockResolvedValueOnce({}); // COMMIT

      await expect(updateTagConnections(1, [10, 20])).resolves.toBeUndefined();

      expect(runDb).toHaveBeenCalledTimes(5);
    });

    it('空连接数组应清除所有关联', async () => {
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN TRANSACTION
        .mockResolvedValueOnce({}) // DELETE
        .mockResolvedValueOnce({}); // COMMIT

      await expect(updateTagConnections(1, [])).resolves.toBeUndefined();

      expect(runDb).toHaveBeenCalledTimes(3);
    });

    it('事务失败时应回滚', async () => {
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN TRANSACTION
        .mockResolvedValueOnce({}) // DELETE
        .mockRejectedValueOnce(new Error('Insert failed')) // INSERT fails
        .mockResolvedValueOnce({}); // ROLLBACK

      await expect(updateTagConnections(1, [10])).rejects.toThrow('更新标签连接关联失败');
    });
  });
});
