/**
 * Proxy Repository 单元测试
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
  findProxyByNameTypeHostPort,
  createProxy,
  findAllProxies,
  findProxyById,
  updateProxy,
  deleteProxy,
} from './proxy.repository';

describe('Proxy Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findProxyByNameTypeHostPort', () => {
    it('应返回匹配的代理 ID', async () => {
      (getDb as any).mockResolvedValueOnce({ id: 1 });

      const result = await findProxyByNameTypeHostPort('MyProxy', 'SOCKS5', '127.0.0.1', 1080);

      expect(result).toEqual({ id: 1 });
      expect(getDb).toHaveBeenCalled();
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('WHERE name = ? AND type = ? AND host = ? AND port = ?');
    });

    it('无匹配时应返回 undefined', async () => {
      (getDb as any).mockResolvedValueOnce(undefined);

      const result = await findProxyByNameTypeHostPort('NonExistent', 'HTTP', '127.0.0.1', 8080);

      expect(result).toBeUndefined();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        findProxyByNameTypeHostPort('Test', 'SOCKS5', '127.0.0.1', 1080)
      ).rejects.toThrow('查找代理时出错');
    });
  });

  describe('createProxy', () => {
    it('应成功创建代理并返回 ID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });

      const result = await createProxy({
        name: 'New Proxy',
        type: 'SOCKS5',
        host: '192.168.1.1',
        port: 1080,
        username: 'user',
        auth_method: 'password',
        encrypted_password: 'enc_pwd',
        encrypted_private_key: null,
        encrypted_passphrase: null,
      });

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO proxies');
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(
        createProxy({
          name: 'Test',
          type: 'SOCKS5',
          host: '127.0.0.1',
          port: 1080,
          auth_method: 'none',
        })
      ).rejects.toThrow('创建代理后未能获取有效的 lastID');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        createProxy({
          name: 'Test',
          type: 'SOCKS5',
          host: '127.0.0.1',
          port: 1080,
          auth_method: 'none',
        })
      ).rejects.toThrow('创建代理时出错');
    });
  });

  describe('findAllProxies', () => {
    it('应返回所有代理列表', async () => {
      const mockProxies = [
        {
          id: 1,
          name: 'Proxy 1',
          type: 'SOCKS5',
          host: '127.0.0.1',
          port: 1080,
          username: null,
          auth_method: 'none',
          encrypted_password: null,
          encrypted_private_key: null,
          encrypted_passphrase: null,
          created_at: 1000,
          updated_at: 1000,
        },
        {
          id: 2,
          name: 'Proxy 2',
          type: 'HTTP',
          host: '192.168.1.1',
          port: 8080,
          username: 'admin',
          auth_method: 'password',
          encrypted_password: 'enc',
          encrypted_private_key: null,
          encrypted_passphrase: null,
          created_at: 1001,
          updated_at: 1001,
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockProxies);

      const result = await findAllProxies();

      expect(result).toEqual(mockProxies);
      expect(allDb).toHaveBeenCalled();
      const call = (allDb as any).mock.calls[0];
      expect(call[1]).toContain('ORDER BY name ASC');
    });

    it('无代理时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findAllProxies();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllProxies()).rejects.toThrow('获取代理列表失败');
    });
  });

  describe('findProxyById', () => {
    it('应返回指定 ID 的代理', async () => {
      const mockProxy = {
        id: 1,
        name: 'Test Proxy',
        type: 'SOCKS5',
        host: '127.0.0.1',
        port: 1080,
        username: null,
        auth_method: 'none',
        encrypted_password: null,
        encrypted_private_key: null,
        encrypted_passphrase: null,
        created_at: 1000,
        updated_at: 1000,
      };
      (getDb as any).mockResolvedValueOnce(mockProxy);

      const result = await findProxyById(1);

      expect(result).toEqual(mockProxy);
      expect(getDb).toHaveBeenCalled();
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('WHERE id = ?');
      expect(call[2]).toContain(1);
    });

    it('代理不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findProxyById(999);

      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findProxyById(1)).rejects.toThrow('获取代理信息失败');
    });
  });

  describe('updateProxy', () => {
    it('应成功更新代理信息', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateProxy(1, {
        name: 'Updated Proxy',
        host: '10.0.0.1',
      });

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE proxies SET');
      expect(call[1]).toContain('name = ?');
      expect(call[1]).toContain('host = ?');
    });

    it('无字段更新时应至少更新时间戳并返回 true', async () => {
      const result = await updateProxy(1, {});

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('updated_at = ?');
    });

    it('代理不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateProxy(999, { name: 'Test' });

      expect(result).toBe(false);
    });

    it('应自动添加 updated_at 字段', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      await updateProxy(1, { name: 'Test' });

      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('updated_at = ?');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(updateProxy(1, { name: 'Test' })).rejects.toThrow('更新代理记录失败');
    });
  });

  describe('deleteProxy', () => {
    it('应成功删除代理', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteProxy(1);

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM proxies WHERE id = ?');
    });

    it('代理不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteProxy(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteProxy(1)).rejects.toThrow('删除代理记录失败');
    });
  });
});
