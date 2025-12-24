import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runDb, getDb, allDb } from '../database/connection';
import {
  addFavoritePath,
  updateFavoritePath,
  deleteFavoritePath,
  getAllFavoritePaths,
  updateFavoritePathLastUsedAt,
  findFavoritePathById,
} from './favorite-paths.repository';

vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn(),
  getDb: vi.fn(),
  allDb: vi.fn(),
}));

describe('favorite-paths.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  describe('addFavoritePath', () => {
    it('应返回插入记录的 lastID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 7 });
      const result = await addFavoritePath('name', '/tmp');
      expect(result).toBe(7);
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0 });
      await expect(addFavoritePath(null, '/tmp')).rejects.toThrow('无法添加收藏路径');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(addFavoritePath(null, '/tmp')).rejects.toThrow('无法添加收藏路径');
    });
  });

  describe('updateFavoritePath', () => {
    it('changes > 0 时应返回 true', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });
      const result = await updateFavoritePath(1, 'n', '/p');
      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE favorite_paths SET name = ?, path = ?');
    });

    it('changes = 0 时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });
      const result = await updateFavoritePath(999, null, '/p');
      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(updateFavoritePath(1, null, '/p')).rejects.toThrow('无法更新收藏路径');
    });
  });

  describe('deleteFavoritePath', () => {
    it('changes > 0 时应返回 true', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });
      const result = await deleteFavoritePath(1);
      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM favorite_paths WHERE id = ?');
    });

    it('changes = 0 时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });
      const result = await deleteFavoritePath(999);
      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(deleteFavoritePath(1)).rejects.toThrow('无法删除收藏路径');
    });
  });

  describe('getAllFavoritePaths', () => {
    it('默认按 name 排序', async () => {
      (allDb as any).mockResolvedValueOnce([{ id: 1 }]);
      const result = await getAllFavoritePaths('name');
      expect(result).toHaveLength(1);
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('ORDER BY name ASC');
    });

    it('按 last_used_at 排序时应包含 last_used_at DESC', async () => {
      (allDb as any).mockResolvedValueOnce([]);
      await getAllFavoritePaths('last_used_at');
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('ORDER BY last_used_at DESC');
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(getAllFavoritePaths('name')).rejects.toThrow('无法获取收藏路径');
    });
  });

  describe('updateFavoritePathLastUsedAt', () => {
    it('changes > 0 时应返回 true', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });
      const result = await updateFavoritePathLastUsedAt(1);
      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE favorite_paths SET last_used_at');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(updateFavoritePathLastUsedAt(1)).rejects.toThrow('无法更新收藏路径上次使用时间');
    });
  });

  describe('findFavoritePathById', () => {
    it('应返回单条记录', async () => {
      (getDb as any).mockResolvedValueOnce({ id: 1, path: '/a' });
      const result = await findFavoritePathById(1);
      expect(result).not.toBeUndefined();
      expect(result?.id).toBe(1);
    });

    it('记录不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);
      const result = await findFavoritePathById(999);
      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(findFavoritePathById(1)).rejects.toThrow('无法查找收藏路径');
    });
  });
});
