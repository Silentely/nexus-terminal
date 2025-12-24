/**
 * User Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDbInstance, getDb, allDb } from '../database/connection';
import { UserRepository, userRepository, User } from './user.repository';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

describe('UserRepository', () => {
  let repository: UserRepository;

  beforeEach(() => {
    repository = new UserRepository();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('findUserById', () => {
    it('应返回存在的用户', async () => {
      const mockUser: User = {
        id: 1,
        username: 'admin',
        hashed_password: 'hashedpwd',
        two_factor_secret: 'secret123',
        created_at: 1000,
        updated_at: 1000,
      };
      (getDb as any).mockResolvedValueOnce(mockUser);

      const result = await repository.findUserById(1);

      expect(result).toEqual(mockUser);
      expect(getDb).toHaveBeenCalled();
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('SELECT');
      expect(call[2]).toContain(1);
    });

    it('用户不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await repository.findUserById(999);

      expect(result).toBeNull();
    });

    it('用户 ID 无效时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(undefined);

      const result = await repository.findUserById(-1);

      expect(result).toBeNull();
    });
  });

  describe('findUserByUsername', () => {
    it('应返回存在的用户', async () => {
      const mockUser: User = {
        id: 1,
        username: 'admin',
        hashed_password: 'hashedpwd',
        two_factor_secret: null,
        created_at: 1000,
        updated_at: 1000,
      };
      (getDb as any).mockResolvedValueOnce(mockUser);

      const result = await repository.findUserByUsername('admin');

      expect(result).toEqual(mockUser);
      expect(getDb).toHaveBeenCalled();
      const call = (getDb as any).mock.calls[0];
      expect(call[1]).toContain('WHERE username = ?');
      expect(call[2]).toContain('admin');
    });

    it('用户名不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await repository.findUserByUsername('nonexistent');

      expect(result).toBeNull();
    });

    it('空用户名应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await repository.findUserByUsername('');

      expect(result).toBeNull();
    });
  });

  describe('userRepository 单例', () => {
    it('应导出一个 UserRepository 实例', () => {
      expect(userRepository).toBeInstanceOf(UserRepository);
    });
  });
});
