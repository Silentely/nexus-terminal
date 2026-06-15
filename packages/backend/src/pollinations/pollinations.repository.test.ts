/**
 * Pollinations Repository 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 数据库连接
vi.mock('../database/connection', () => {
  const mockDb = {
    get: vi.fn(),
    all: vi.fn(),
    run: vi.fn(),
  };
  return {
    getDbInstance: vi.fn().mockResolvedValue(mockDb),
    runDb: vi.fn(),
    getDb: vi.fn(),
    allDb: vi.fn(),
  };
});

// Mock 加密模块
vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((text: string) => `encrypted_${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted_', '')),
}));

describe('Pollinations Repository', () => {
  let mockGetDb: ReturnType<typeof vi.fn>;
  let mockRunDb: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { getDb, runDb } = await import('../database/connection');
    mockGetDb = vi.mocked(getDb);
    mockRunDb = vi.mocked(runDb);
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getUserSettings', () => {
    it('当用户无配置时返回 null', async () => {
      const { getUserSettings } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue(undefined);

      const result = await getUserSettings(1);

      expect(result).toBeNull();
      expect(mockGetDb).toHaveBeenCalled();
    });

    it('应正确解密敏感字段并返回配置', async () => {
      const { getUserSettings } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue({
        user_id: 1,
        encrypted_app_key: 'encrypted_pk_test123',
        encrypted_user_key: 'encrypted_sk_userkey456',
        scope: 'usage,keys',
        models: 'openai,claude,gemini',
        budget: 5.0,
        expiry: 604800,
        enabled: 1,
        created_at: 1234567890,
        updated_at: 1234567890,
      });

      const result = await getUserSettings(1);

      expect(result).not.toBeNull();
      expect(result?.app_key).toBe('pk_test123');
      expect(result?.user_key).toBe('sk_userkey456');
      expect(result?.models).toEqual(['openai', 'claude', 'gemini']);
      expect(result?.enabled).toBe(true);
    });

    it('当 user_key 为 null 时应正确处理', async () => {
      const { getUserSettings } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue({
        user_id: 1,
        encrypted_app_key: 'encrypted_pk_test123',
        encrypted_user_key: null,
        scope: 'usage',
        models: 'openai',
        budget: 10,
        expiry: 3600,
        enabled: 0,
        created_at: 1234567890,
        updated_at: 1234567890,
      });

      const result = await getUserSettings(1);

      expect(result).not.toBeNull();
      expect(result?.user_key).toBeNull();
      expect(result?.enabled).toBe(false);
    });
  });

  describe('isPollinationsEnabled', () => {
    it('当配置不存在时返回 false', async () => {
      const { isPollinationsEnabled } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue(undefined);

      const result = await isPollinationsEnabled(1);

      expect(result).toBe(false);
    });

    it('当 enabled=1 且有 user_key 时返回 true', async () => {
      const { isPollinationsEnabled } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue({
        enabled: 1,
        encrypted_user_key: 'encrypted_sk_key',
      });

      const result = await isPollinationsEnabled(1);

      expect(result).toBe(true);
    });

    it('当 enabled=1 但无 user_key 时返回 false', async () => {
      const { isPollinationsEnabled } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue({
        enabled: 1,
        encrypted_user_key: null,
      });

      const result = await isPollinationsEnabled(1);

      expect(result).toBe(false);
    });

    it('当 enabled=0 时返回 false', async () => {
      const { isPollinationsEnabled } = await import('./pollinations.repository');
      mockGetDb.mockResolvedValue({
        enabled: 0,
        encrypted_user_key: 'encrypted_sk_key',
      });

      const result = await isPollinationsEnabled(1);

      expect(result).toBe(false);
    });
  });

  describe('saveSettings', () => {
    it('应正确加密敏感字段并保存', async () => {
      const { saveSettings } = await import('./pollinations.repository');
      mockRunDb.mockResolvedValue({ lastID: 1, changes: 1 });

      await saveSettings(1, {
        app_key: 'pk_test123',
        scope: 'usage,keys',
        models: ['openai', 'claude'],
        budget: 10,
        expiry: 86400,
        enabled: true,
      });

      expect(mockRunDb).toHaveBeenCalled();
    });
  });

  describe('updateUserKey', () => {
    it('应加密 user_key 并更新数据库', async () => {
      const { updateUserKey } = await import('./pollinations.repository');
      mockRunDb.mockResolvedValue({ lastID: 1, changes: 1 });

      await updateUserKey(1, 'sk_new_user_key');

      expect(mockRunDb).toHaveBeenCalled();
    });
  });

  describe('clearUserKey', () => {
    it('应清除 user_key 并禁用', async () => {
      const { clearUserKey } = await import('./pollinations.repository');
      mockRunDb.mockResolvedValue({ lastID: 1, changes: 1 });

      await clearUserKey(1);

      expect(mockRunDb).toHaveBeenCalled();
    });
  });
});
