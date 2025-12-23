/**
 * Audit Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import { AuditLogRepository } from './audit.repository';

describe('AuditLogRepository', () => {
  let repository: AuditLogRepository;

  beforeEach(() => {
    repository = new AuditLogRepository();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('addLog', () => {
    it('应成功添加审计日志', async () => {
      // Mock cleanupOldLogs 不会删除（总数不超过限制）
      (getDb as any).mockResolvedValueOnce({ total: 100 });

      await repository.addLog('user_login', { username: 'admin' });

      expect(runDb).toHaveBeenCalledTimes(1);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO audit_logs');
      expect(call[2][1]).toBe('user_login');
    });

    it('应正确序列化对象类型的 details', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 100 });

      const details = { ip: '192.168.1.1', browser: 'Chrome' };
      await repository.addLog('user_login', details);

      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBe(JSON.stringify(details));
    });

    it('应正确处理字符串类型的 details', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 100 });

      await repository.addLog('user_logout', 'Session ended');

      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBe('Session ended');
    });

    it('details 为 null 时应存储 null', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 100 });

      await repository.addLog('user_logout', null);

      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBeNull();
    });

    it('details 为 undefined 时应存储 null', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 100 });

      await repository.addLog('user_logout');

      const call = (runDb as any).mock.calls[0];
      expect(call[2][2]).toBeNull();
    });

    it('当日志数量超过限制时应触发清理', async () => {
      // 模拟日志数量超过 50000
      // 第一次 getDb 调用来自 settingsService.getAuditLogMaxEntries -> settingsRepository.getSetting
      // 第二次 getDb 调用来自 cleanupOldLogs -> SELECT COUNT(*)
      (getDb as any).mockResolvedValueOnce(null).mockResolvedValueOnce({ total: 50100 });

      await repository.addLog('user_login');

      // 应该调用两次 runDb：一次 INSERT，一次 DELETE
      expect(runDb).toHaveBeenCalledTimes(2);
      const deleteCall = (runDb as any).mock.calls[1];
      expect(deleteCall[1]).toContain('DELETE FROM audit_logs');
      expect(deleteCall[2]).toEqual([100]); // 删除 100 条
    });

    it('数据库错误时不应抛出异常（仅记录日志）', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      // 不应抛出异常
      await expect(repository.addLog('user_login')).resolves.toBeUndefined();
    });
  });

  describe('getLogs', () => {
    it('应返回审计日志列表和总数', async () => {
      const mockLogs = [
        { id: 1, timestamp: 1000, action_type: 'user_login', details: '{"ip":"192.168.1.1"}' },
        { id: 2, timestamp: 1001, action_type: 'user_logout', details: null },
      ];
      (getDb as any).mockResolvedValueOnce({ total: 2 });
      (allDb as any).mockResolvedValueOnce(mockLogs);

      const result = await repository.getLogs(50, 0);

      expect(result.logs).toHaveLength(2);
      expect(result.total).toBe(2);
    });

    it('应支持 actionType 过滤', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 1 });
      (allDb as any).mockResolvedValueOnce([]);

      await repository.getLogs(50, 0, 'user_login');

      const allDbCall = (allDb as any).mock.calls[0];
      expect(allDbCall[1]).toContain('action_type = ?');
      expect(allDbCall[2]).toContain('user_login');
    });

    it('应支持 searchTerm 过滤', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 1 });
      (allDb as any).mockResolvedValueOnce([]);

      await repository.getLogs(50, 0, undefined, undefined, undefined, 'admin');

      const allDbCall = (allDb as any).mock.calls[0];
      expect(allDbCall[1]).toContain('details LIKE ?');
      expect(allDbCall[2]).toContain('%admin%');
    });

    it('应支持组合过滤', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 1 });
      (allDb as any).mockResolvedValueOnce([]);

      await repository.getLogs(50, 0, 'user_login', undefined, undefined, 'admin');

      const allDbCall = (allDb as any).mock.calls[0];
      expect(allDbCall[1]).toContain('action_type = ?');
      expect(allDbCall[1]).toContain('details LIKE ?');
      expect(allDbCall[1]).toContain('AND');
    });

    it('应正确使用分页参数', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 100 });
      (allDb as any).mockResolvedValueOnce([]);

      await repository.getLogs(20, 40);

      const allDbCall = (allDb as any).mock.calls[0];
      expect(allDbCall[1]).toContain('LIMIT ? OFFSET ?');
      expect(allDbCall[2]).toContain(20);
      expect(allDbCall[2]).toContain(40);
    });

    it('无日志时应返回空数组和 0', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 0 });
      (allDb as any).mockResolvedValueOnce([]);

      const result = await repository.getLogs();

      expect(result.logs).toHaveLength(0);
      expect(result.total).toBe(0);
    });

    it('count 结果为 null 时应返回 total 为 0', async () => {
      (getDb as any).mockResolvedValueOnce(null);
      (allDb as any).mockResolvedValueOnce([]);

      const result = await repository.getLogs();

      expect(result.total).toBe(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(repository.getLogs()).rejects.toThrow('获取审计日志时出错');
    });
  });

  describe('deleteAllLogs', () => {
    it('应删除所有日志并返回删除条数', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 42 });
      const deleted = await repository.deleteAllLogs();
      expect(getDbInstance).toHaveBeenCalled();
      expect(runDb).toHaveBeenCalledWith(expect.anything(), 'DELETE FROM audit_logs', []);
      expect(deleted).toBe(42);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('fail'));
      await expect(repository.deleteAllLogs()).rejects.toThrow('删除审计日志失败');
    });
  });

  describe('getLogCount', () => {
    it('应返回审计日志总数', async () => {
      (getDb as any).mockResolvedValueOnce({ total: 7 });
      const count = await repository.getLogCount();
      expect(getDbInstance).toHaveBeenCalled();
      expect(getDb).toHaveBeenCalledWith(
        expect.anything(),
        'SELECT COUNT(*) as total FROM audit_logs'
      );
      expect(count).toBe(7);
    });

    it('当查询返回 null 时应回退为 0', async () => {
      (getDb as any).mockResolvedValueOnce(null);
      const count = await repository.getLogCount();
      expect(count).toBe(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('boom'));
      await expect(repository.getLogCount()).rejects.toThrow('获取审计日志总数失败');
    });
  });
});
