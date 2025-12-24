import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runDb, getDb, allDb } from '../database/connection';
import { upsertPath, getAllPaths, deletePathById, clearAllPaths } from './path-history.repository';

vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn(),
  getDb: vi.fn(),
  allDb: vi.fn(),
}));

describe('path-history.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  describe('upsertPath', () => {
    it('路径已存在时应更新 timestamp 并返回原记录 ID', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      (runDb as any).mockResolvedValueOnce({ changes: 1 }); // update
      (getDb as any).mockResolvedValueOnce({ id: 99 }); // select

      const id = await upsertPath('/home');
      expect(id).toBe(99);

      const updateCall = (runDb as any).mock.calls[0];
      expect(updateCall[1]).toContain('UPDATE path_history SET timestamp = ?');
      expect(updateCall[2]).toEqual([1700000000, '/home']);

      const selectCall = (getDb as any).mock.calls[0];
      expect(selectCall[1]).toContain('SELECT id FROM path_history WHERE path = ?');
      expect(selectCall[2]).toEqual(['/home']);
    });

    it('更新成功但未找到记录 ID 时应抛出异常', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      (runDb as any).mockResolvedValueOnce({ changes: 1 });
      (getDb as any).mockResolvedValueOnce(null);

      await expect(upsertPath('/home')).rejects.toThrow('无法更新或插入路径历史记录');
    });

    it('路径不存在时应插入并返回 lastID', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      (runDb as any).mockResolvedValueOnce({ changes: 0 }); // update
      (runDb as any).mockResolvedValueOnce({ lastID: 123 }); // insert

      const id = await upsertPath('/new');
      expect(id).toBe(123);

      const insertCall = (runDb as any).mock.calls[1];
      expect(insertCall[1]).toContain('INSERT INTO path_history (path, timestamp) VALUES (?, ?)');
      expect(insertCall[2]).toEqual(['/new', 1700000000]);
    });

    it('插入后 lastID 无效时应抛出异常', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      (runDb as any).mockResolvedValueOnce({ changes: 0 });
      (runDb as any).mockResolvedValueOnce({ lastID: 0 });

      await expect(upsertPath('/new')).rejects.toThrow('无法更新或插入路径历史记录');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(upsertPath('/home')).rejects.toThrow('无法更新或插入路径历史记录');
    });
  });

  describe('getAllPaths', () => {
    it('应按 timestamp ASC 获取所有记录', async () => {
      (allDb as any).mockResolvedValueOnce([{ id: 1, path: '/a', timestamp: 1 }]);
      const result = await getAllPaths();
      expect(result).toHaveLength(1);

      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('ORDER BY timestamp ASC');
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(getAllPaths()).rejects.toThrow('无法获取路径历史记录');
    });
  });

  describe('deletePathById', () => {
    it('changes > 0 时应返回 true', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });
      const result = await deletePathById(1);
      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM path_history WHERE id = ?');
    });

    it('changes = 0 时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });
      const result = await deletePathById(999);
      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(deletePathById(1)).rejects.toThrow('无法删除路径历史记录');
    });
  });

  describe('clearAllPaths', () => {
    it('应返回删除的行数', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 5 });
      const result = await clearAllPaths();
      expect(result).toBe(5);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM path_history');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(clearAllPaths()).rejects.toThrow('无法清空路径历史记录');
    });
  });
});
