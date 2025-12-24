/**
 * SSH Key Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import {
  createSshKey,
  findSshKeyById,
  findAllSshKeyNames,
  findAllSshKeys,
  updateSshKey,
  deleteSshKey,
} from './ssh-keys.repository';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

describe('SSH Key Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const mockDbRow = {
    id: 1,
    name: 'My SSH Key',
    encrypted_private_key: 'encrypted_key_content',
    encrypted_passphrase: 'encrypted_passphrase',
    created_at: 1000,
    updated_at: 1000,
  };

  describe('createSshKey', () => {
    it('应成功创建 SSH 密钥并返回 ID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });

      const result = await createSshKey({
        name: 'New SSH Key',
        encrypted_private_key: 'encrypted_key',
        encrypted_passphrase: 'encrypted_pass',
      });

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO ssh_keys');
    });

    it('应支持无密码短语的密钥', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 6, changes: 1 });

      const result = await createSshKey({
        name: 'Key Without Passphrase',
        encrypted_private_key: 'encrypted_key',
        encrypted_passphrase: null,
      });

      expect(result).toBe(6);
      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBeNull();
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(
        createSshKey({
          name: 'Test',
          encrypted_private_key: 'key',
        })
      ).rejects.toThrow('创建 SSH 密钥失败');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        createSshKey({
          name: 'Test',
          encrypted_private_key: 'key',
        })
      ).rejects.toThrow('创建 SSH 密钥失败');
    });
  });

  describe('findSshKeyById', () => {
    it('应返回指定 ID 的 SSH 密钥', async () => {
      (getDb as any).mockResolvedValueOnce(mockDbRow);

      const result = await findSshKeyById(1);

      expect(result).toEqual(mockDbRow);
      expect(getDb).toHaveBeenCalled();
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('WHERE id = ?');
    });

    it('密钥不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findSshKeyById(999);

      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findSshKeyById(1)).rejects.toThrow('查找 SSH 密钥失败');
    });
  });

  describe('findAllSshKeyNames', () => {
    it('应返回所有 SSH 密钥名称列表', async () => {
      const mockNames = [
        { id: 1, name: 'Key A' },
        { id: 2, name: 'Key B' },
      ];
      (allDb as any).mockResolvedValueOnce(mockNames);

      const result = await findAllSshKeyNames();

      expect(result).toEqual(mockNames);
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('SELECT id, name FROM ssh_keys');
      expect(call[1]).toContain('ORDER BY name ASC');
    });

    it('无密钥时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findAllSshKeyNames();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllSshKeyNames()).rejects.toThrow('查找所有 SSH 密钥名称失败');
    });
  });

  describe('findAllSshKeys', () => {
    it('应返回所有 SSH 密钥完整记录', async () => {
      const mockKeys = [mockDbRow, { ...mockDbRow, id: 2, name: 'Key B' }];
      (allDb as any).mockResolvedValueOnce(mockKeys);

      const result = await findAllSshKeys();

      expect(result).toHaveLength(2);
      expect(result[0].encrypted_private_key).toBe('encrypted_key_content');
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllSshKeys()).rejects.toThrow('查找所有 SSH 密钥记录失败');
    });
  });

  describe('updateSshKey', () => {
    it('应成功更新 SSH 密钥', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateSshKey(1, {
        name: 'Updated Key Name',
        encrypted_private_key: 'new_encrypted_key',
      });

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE ssh_keys SET');
    });

    it('无字段需要更新时应返回 true', async () => {
      const result = await updateSshKey(1, {});

      expect(result).toBe(true);
      expect(runDb).not.toHaveBeenCalled();
    });

    it('应自动添加 updated_at 时间戳', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      await updateSshKey(1, { name: 'Test' });

      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('updated_at');
    });

    it('密钥不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateSshKey(999, { name: 'Test' });

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(updateSshKey(1, { name: 'Test' })).rejects.toThrow('更新 SSH 密钥失败');
    });
  });

  describe('deleteSshKey', () => {
    it('应成功删除 SSH 密钥', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteSshKey(1);

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM ssh_keys WHERE id = ?');
    });

    it('密钥不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteSshKey(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteSshKey(1)).rejects.toThrow('删除 SSH 密钥失败');
    });
  });
});
