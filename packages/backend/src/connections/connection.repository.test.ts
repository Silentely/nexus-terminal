/**
 * Connection Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runDb, getDb, allDb } from '../database/connection';
import {
  findAllConnectionsWithTags,
  findConnectionByIdWithTags,
  findFullConnectionById,
  findConnectionByName,
  createConnection,
  updateConnection,
  deleteConnection,
  updateLastConnected,
  updateConnectionTags,
  findConnectionTags,
  bulkInsertConnections,
  addTagToMultipleConnections,
} from './connection.repository';

// Mock 缓存服务（防止测试间缓存泄漏）
vi.mock('../services/cache.service', () => ({
  cacheService: {
    get: vi.fn().mockReturnValue(null),
    set: vi.fn(),
    delete: vi.fn(),
    clear: vi.fn(),
  },
}));

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

describe('Connection Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('findAllConnectionsWithTags', () => {
    it('应返回带标签的连接列表', async () => {
      const mockRows = [
        {
          id: 1,
          name: 'Server 1',
          type: 'SSH',
          host: '192.168.1.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
          proxy_id: null,
          proxy_type: null,
          ssh_key_id: null,
          notes: 'Test server',
          jump_chain: null,
          created_at: 1000,
          updated_at: 1000,
          last_connected_at: null,
          tag_ids_str: '1,2,3',
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockRows);

      const result = await findAllConnectionsWithTags();

      expect(result).toHaveLength(1);
      expect(result[0].tag_ids).toEqual([1, 2, 3]);
      expect(result[0].jump_chain).toBeNull();
    });

    it('应正确解析 jump_chain JSON', async () => {
      const mockRows = [
        {
          id: 1,
          name: 'Server 1',
          type: 'SSH',
          host: '192.168.1.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
          proxy_id: null,
          proxy_type: null,
          ssh_key_id: null,
          notes: null,
          jump_chain: '[1, 2, 3]',
          created_at: 1000,
          updated_at: 1000,
          last_connected_at: null,
          tag_ids_str: null,
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockRows);

      const result = await findAllConnectionsWithTags();

      expect(result[0].jump_chain).toEqual([1, 2, 3]);
      expect(result[0].tag_ids).toEqual([]);
    });

    it('无连接时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findAllConnectionsWithTags();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllConnectionsWithTags()).rejects.toThrow('获取连接列表失败');
    });
  });

  describe('findConnectionByIdWithTags', () => {
    it('应返回指定 ID 的连接', async () => {
      const mockRow = {
        id: 1,
        name: 'Server 1',
        type: 'SSH',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        auth_method: 'password',
        proxy_id: null,
        proxy_type: null,
        ssh_key_id: null,
        notes: null,
        jump_chain: null,
        created_at: 1000,
        updated_at: 1000,
        last_connected_at: null,
        tag_ids_str: '1,2',
      };
      (getDb as any).mockResolvedValueOnce(mockRow);

      const result = await findConnectionByIdWithTags(1);

      expect(result?.id).toBe(1);
      expect(result?.tag_ids).toEqual([1, 2]);
    });

    it('连接不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findConnectionByIdWithTags(999);

      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findConnectionByIdWithTags(1)).rejects.toThrow('获取连接信息失败');
    });
  });

  describe('findFullConnectionById', () => {
    it('应返回包含加密字段的完整连接信息', async () => {
      const mockRow = {
        id: 1,
        name: 'Server 1',
        type: 'SSH',
        host: '192.168.1.1',
        port: 22,
        username: 'root',
        auth_method: 'password',
        encrypted_password: 'enc_pwd',
        proxy_db_id: null,
        proxy_name: null,
        actual_proxy_server_type: null,
        proxy_host: null,
        proxy_port: null,
        proxy_username: null,
      };
      (getDb as any).mockResolvedValueOnce(mockRow);

      const result = await findFullConnectionById(1);

      expect(result?.encrypted_password).toBe('enc_pwd');
    });

    it('连接不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findFullConnectionById(999);

      expect(result).toBeNull();
    });
  });

  describe('findConnectionByName', () => {
    it('应返回指定名称的连接', async () => {
      const mockRow = {
        id: 1,
        name: 'Production Server',
        type: 'SSH',
        host: '192.168.1.1',
        port: 22,
        username: 'admin',
        auth_method: 'key',
        proxy_id: null,
        proxy_type: null,
        ssh_key_id: 1,
        notes: null,
        jump_chain: null,
        created_at: 1000,
        updated_at: 1000,
        last_connected_at: null,
        tag_ids_str: null,
      };
      (getDb as any).mockResolvedValueOnce(mockRow);

      const result = await findConnectionByName('Production Server');

      expect(result?.name).toBe('Production Server');
    });

    it('名称不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findConnectionByName('NonExistent');

      expect(result).toBeNull();
    });
  });

  describe('createConnection', () => {
    it('应成功创建连接并返回 ID', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });

      const result = await createConnection({
        name: 'New Server',
        type: 'SSH',
        host: '10.0.0.1',
        port: 22,
        username: 'user',
        auth_method: 'password',
        proxy_id: null,
        proxy_type: null,
        encrypted_password: 'enc_pwd',
        jump_chain: null,
      });

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
    });

    it('应正确处理 jump_chain 数组', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 6, changes: 1 });

      await createConnection({
        name: 'Chained Server',
        type: 'SSH',
        host: '10.0.0.2',
        port: 22,
        username: 'user',
        auth_method: 'key',
        proxy_id: null,
        proxy_type: 'jump',
        jump_chain: [1, 2, 3],
      });

      const call = (runDb as any).mock.calls[0];
      expect(call[2]).toContain('[1,2,3]');
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(
        createConnection({
          name: 'Test',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'user',
          auth_method: 'password',
          proxy_id: null,
          jump_chain: null,
        }),
      ).rejects.toThrow('创建连接记录失败');
    });
  });

  describe('updateConnection', () => {
    it('应成功更新连接', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateConnection(1, { name: 'Updated Name' });

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
    });

    it('无业务字段更新时应跳过更新并返回 false', async () => {
      const result = await updateConnection(1, {});

      expect(result).toBe(false);
      expect(runDb).not.toHaveBeenCalled();
    });

    it('连接不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateConnection(999, { name: 'Test' });

      expect(result).toBe(false);
    });
  });

  describe('deleteConnection', () => {
    it('应成功删除连接', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteConnection(1);

      expect(result).toBe(true);
    });

    it('连接不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteConnection(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteConnection(1)).rejects.toThrow('删除连接记录失败');
    });
  });

  describe('updateLastConnected', () => {
    it('应成功更新最后连接时间', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateLastConnected(1, 1234567890);

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[2]).toContain(1234567890);
    });

    it('连接不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateLastConnected(999, 1234567890);

      expect(result).toBe(false);
    });
  });

  describe('updateConnectionTags', () => {
    it('应成功更新连接标签', async () => {
      // Mock 连接存在检查
      (getDb as any).mockResolvedValueOnce({ id: 1 });
      // Mock 事务操作
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN TRANSACTION
        .mockResolvedValueOnce({}) // DELETE
        .mockResolvedValueOnce({}) // INSERT tag 1
        .mockResolvedValueOnce({}) // INSERT tag 2
        .mockResolvedValueOnce({}); // COMMIT

      const result = await updateConnectionTags(1, [1, 2]);

      expect(result).toBe(true);
    });

    it('连接不存在时应返回 false', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await updateConnectionTags(999, [1, 2]);

      expect(result).toBe(false);
    });

    it('空标签数组应清除所有标签', async () => {
      (getDb as any).mockResolvedValueOnce({ id: 1 });
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN TRANSACTION
        .mockResolvedValueOnce({}) // DELETE
        .mockResolvedValueOnce({}); // COMMIT

      const result = await updateConnectionTags(1, []);

      expect(result).toBe(true);
    });
  });

  describe('findConnectionTags', () => {
    it('应返回连接的标签列表', async () => {
      const mockTags = [
        { id: 1, name: 'Production' },
        { id: 2, name: 'Linux' },
      ];
      (allDb as any).mockResolvedValueOnce(mockTags);

      const result = await findConnectionTags(1);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('Production');
    });

    it('无标签时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findConnectionTags(1);

      expect(result).toHaveLength(0);
    });

    it('数据库查询失败时应抛出错误', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findConnectionTags(1)).rejects.toThrow('获取连接标签失败');
    });
  });

  describe('bulkInsertConnections', () => {
    it('应批量插入连接并返回结果', async () => {
      (runDb as any)
        .mockResolvedValueOnce({ lastID: 1, changes: 1 })
        .mockResolvedValueOnce({ lastID: 2, changes: 1 });

      const connections = [
        {
          name: 'Server 1',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
        },
        {
          name: 'Server 2',
          type: 'RDP',
          host: '10.0.0.2',
          port: 3389,
          username: 'admin',
          auth_method: 'password',
        },
      ];

      const result = await bulkInsertConnections({} as any, connections);

      expect(result).toHaveLength(2);
      expect(result[0].connectionId).toBe(1);
      expect(result[1].connectionId).toBe(2);
    });

    it('空数组应返回空结果', async () => {
      const result = await bulkInsertConnections({} as any, []);

      expect(result).toEqual([]);
    });

    it('插入失败时应抛出错误', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Insert failed'));

      const connections = [
        {
          name: 'Failed',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
        },
      ];

      await expect(bulkInsertConnections({} as any, connections)).rejects.toThrow();
    });

    it('lastID 无效时应抛出错误', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 1 });

      const connections = [
        {
          name: 'Invalid',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
        },
      ];

      await expect(bulkInsertConnections({} as any, connections)).rejects.toThrow();
    });
  });

  describe('addTagToMultipleConnections', () => {
    it('应为多个连接添加同一标签', async () => {
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({}) // INSERT 1
        .mockResolvedValueOnce({}) // INSERT 2
        .mockResolvedValueOnce({}); // COMMIT

      await addTagToMultipleConnections([1, 2], 5);

      expect(runDb).toHaveBeenCalled();
    });

    it('空连接 ID 数组应直接返回', async () => {
      await addTagToMultipleConnections([], 5);

      expect(runDb).not.toHaveBeenCalled();
    });

    it('无效标签 ID 应直接返回', async () => {
      await addTagToMultipleConnections([1, 2], 0);

      expect(runDb).not.toHaveBeenCalled();
    });

    it('负数标签 ID 应直接返回', async () => {
      await addTagToMultipleConnections([1, 2], -1);

      expect(runDb).not.toHaveBeenCalled();
    });

    it('事务失败时应回滚并抛出错误', async () => {
      (runDb as any)
        .mockResolvedValueOnce({}) // BEGIN
        .mockRejectedValueOnce(new Error('Insert failed')); // INSERT

      await expect(addTagToMultipleConnections([1, 2], 5)).rejects.toThrow();
    });
  });

  describe('updateConnection 边界条件', () => {
    it('应正确处理 force_keyboard_interactive 布尔值', async () => {
      (runDb as any).mockResolvedValue({ changes: 1 });

      await updateConnection(1, { force_keyboard_interactive: true });

      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('force_keyboard_interactive');
    });

    it('应正确处理 jump_chain 为空数组', async () => {
      (runDb as any).mockResolvedValue({ changes: 1 });

      await updateConnection(1, { jump_chain: [] });

      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('jump_chain');
    });

    it('应正确处理 jump_chain 为非空数组', async () => {
      (runDb as any).mockResolvedValue({ changes: 1 });

      await updateConnection(1, { jump_chain: [1, 2] });

      const call = (runDb as any).mock.calls[0];
      expect(call[2]).toContain('[1,2]');
    });

    it('数据库更新失败时应抛出错误', async () => {
      (runDb as any).mockRejectedValue(new Error('Database error'));

      await expect(updateConnection(1, { name: 'test' })).rejects.toThrow('更新连接记录失败');
    });
  });

  describe('findAllConnectionsWithTags 边界条件', () => {
    it('应正确处理 force_keyboard_interactive 为 1 的情况', async () => {
      const mockRows = [
        {
          id: 1,
          name: 'Server',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
          proxy_id: null,
          proxy_type: null,
          ssh_key_id: null,
          notes: null,
          jump_chain: null,
          force_keyboard_interactive: 1,
          created_at: 1000,
          updated_at: 1000,
          last_connected_at: null,
          tag_ids_str: null,
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockRows);

      const result = await findAllConnectionsWithTags();

      expect(result[0].force_keyboard_interactive).toBe(true);
    });

    it('应正确处理包含无效 tag_id 的情况', async () => {
      const mockRows = [
        {
          id: 1,
          name: 'Server',
          type: 'SSH',
          host: '10.0.0.1',
          port: 22,
          username: 'root',
          auth_method: 'password',
          proxy_id: null,
          proxy_type: null,
          ssh_key_id: null,
          notes: null,
          jump_chain: null,
          force_keyboard_interactive: 0,
          created_at: 1000,
          updated_at: 1000,
          last_connected_at: null,
          tag_ids_str: '1,abc,3',
        },
      ];
      (allDb as any).mockResolvedValueOnce(mockRows);

      const result = await findAllConnectionsWithTags();

      expect(result[0].tag_ids).toEqual([1, 3]);
    });
  });
});
