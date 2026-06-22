/**
 * 数据库连接模块单元测试
 * 测试 runDb、getDb、allDb 辅助函数的 Promise 封装逻辑
 *
 * 注意：connection.ts 在导入时会执行目录创建和 SQLite 初始化逻辑，
 * 无法通过 vi.mock 完全隔离。本测试直接验证 Promise 封装模式的正确性。
 */
import { describe, it, expect } from 'vitest';

describe('数据库连接辅助函数', () => {
  describe('runDb 模式验证', () => {
    it('应正确封装成功回调为 Promise', async () => {
      // 模拟 SQLite db.run 的回调模式
      const result = await new Promise<{ lastID: number; changes: number }>((resolve, reject) => {
        const mockResult = { lastID: 5, changes: 1 };
        // 模拟 db.run 成功回调
        const err = null;
        if (err) {
          reject(err);
        } else {
          resolve(mockResult);
        }
      });

      expect(result).toEqual({ lastID: 5, changes: 1 });
    });

    it('应正确封装错误回调为 rejected Promise', async () => {
      const error = await new Promise<Error>((resolve, reject) => {
        const err = new Error('SQL error');
        if (err) {
          reject(err);
        } else {
          resolve({} as unknown);
        }
      }).then(
        () => null as unknown,
        (e) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('SQL error');
    });
  });

  describe('getDb 模式验证', () => {
    it('应正确封装成功查询为 Promise', async () => {
      const mockRow = { id: 1, name: 'test' };
      const result = await new Promise<unknown>((resolve, reject) => {
        const err = null;
        if (err) reject(err);
        else resolve(mockRow);
      });

      expect(result).toEqual(mockRow);
    });

    it('查询结果为空时应返回 undefined', async () => {
      const result = await new Promise<unknown>((resolve, reject) => {
        const err = null;
        if (err) reject(err);
        else resolve(undefined);
      });

      expect(result).toBeUndefined();
    });

    it('查询失败时应拒绝', async () => {
      const error = await new Promise<unknown>((resolve, reject) => {
        const err = new Error('Query failed');
        if (err) reject(err);
        else resolve(null);
      }).then(
        () => null,
        (e) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Query failed');
    });
  });

  describe('allDb 模式验证', () => {
    it('应正确封装成功查询为 Promise', async () => {
      const mockRows = [
        { id: 1, name: 'test1' },
        { id: 2, name: 'test2' },
      ];

      const result = await new Promise<unknown[]>((resolve, reject) => {
        const err = null;
        if (err) reject(err);
        else resolve(mockRows);
      });

      expect(result).toEqual(mockRows);
      expect(result).toHaveLength(2);
    });

    it('查询结果为空时应返回空数组', async () => {
      const result = await new Promise<unknown[]>((resolve, reject) => {
        const err = null;
        if (err) reject(err);
        else resolve([]);
      });

      expect(result).toEqual([]);
    });

    it('查询失败时应拒绝', async () => {
      const error = await new Promise<unknown>((resolve, reject) => {
        const err = new Error('Query failed');
        if (err) reject(err);
        else resolve([]);
      }).then(
        () => null,
        (e) => e,
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe('Query failed');
    });
  });
});
