/**
 * Settings Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import {
  settingsRepository,
  getSidebarConfig,
  setSidebarConfig,
  getCaptchaConfig,
  setCaptchaConfig,
} from './settings.repository';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

describe('Settings Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('settingsRepository.getAllSettings', () => {
    it('应返回所有设置项', async () => {
      const mockSettings = [
        { key: 'setting1', value: 'value1' },
        { key: 'setting2', value: 'value2' },
      ];
      (allDb as any).mockResolvedValueOnce(mockSettings);

      const result = await settingsRepository.getAllSettings();

      expect(result).toEqual(mockSettings);
      expect(allDb).toHaveBeenCalled();
    });

    it('无设置时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await settingsRepository.getAllSettings();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(settingsRepository.getAllSettings()).rejects.toThrow('获取设置失败');
    });
  });

  describe('settingsRepository.getSetting', () => {
    it('应返回指定键的值', async () => {
      (getDb as any).mockResolvedValueOnce({ value: 'test-value' });

      const result = await settingsRepository.getSetting('testKey');

      expect(result).toBe('test-value');
    });

    it('键不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await settingsRepository.getSetting('nonExistent');

      expect(result).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(settingsRepository.getSetting('key')).rejects.toThrow('获取设置项失败');
    });
  });

  describe('settingsRepository.setSetting', () => {
    it('应成功设置设置项', async () => {
      await settingsRepository.setSetting('testKey', 'testValue');

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO settings');
      expect(call[2]).toContain('testKey');
      expect(call[2]).toContain('testValue');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(settingsRepository.setSetting('key', 'value')).rejects.toThrow('设置设置项失败');
    });
  });

  describe('settingsRepository.deleteSetting', () => {
    it('删除成功时应返回 true', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await settingsRepository.deleteSetting('testKey');

      expect(result).toBe(true);
      expect(runDb).toHaveBeenCalled();
    });

    it('键不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await settingsRepository.deleteSetting('nonExistent');

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(settingsRepository.deleteSetting('key')).rejects.toThrow('删除设置项失败');
    });
  });

  describe('settingsRepository.setMultipleSettings', () => {
    it('应成功批量设置', async () => {
      const settings = { key1: 'value1', key2: 'value2' };

      await settingsRepository.setMultipleSettings(settings);

      expect(runDb).toHaveBeenCalledTimes(2);
    });

    it('批量设置失败时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(settingsRepository.setMultipleSettings({ key1: 'value1' })).rejects.toThrow(
        '批量设置失败'
      );
    });
  });

  describe('getSidebarConfig', () => {
    it('应返回存储的侧栏配置', async () => {
      const mockConfig = { left: ['connections'], right: ['dockerManager'] };
      (getDb as any).mockResolvedValueOnce({ value: JSON.stringify(mockConfig) });

      const result = await getSidebarConfig();

      expect(result).toEqual(mockConfig);
    });

    it('无配置时应返回默认值', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await getSidebarConfig();

      expect(result).toEqual({ left: [], right: [] });
    });

    it('配置格式无效时应返回默认值', async () => {
      (getDb as any).mockResolvedValueOnce({ value: 'invalid-json' });

      const result = await getSidebarConfig();

      expect(result).toEqual({ left: [], right: [] });
    });

    it('配置结构无效时应返回默认值', async () => {
      (getDb as any).mockResolvedValueOnce({ value: JSON.stringify({ left: 'not-array' }) });

      const result = await getSidebarConfig();

      expect(result).toEqual({ left: [], right: [] });
    });
  });

  describe('setSidebarConfig', () => {
    it('应成功保存侧栏配置', async () => {
      const config = { left: ['connections'], right: [] };

      await setSidebarConfig(config);

      expect(runDb).toHaveBeenCalled();
    });

    it('配置无效时应抛出异常', async () => {
      await expect(setSidebarConfig({} as any)).rejects.toThrow('保存侧边栏配置失败。');
    });

    it('配置为 null 时应抛出异常', async () => {
      await expect(setSidebarConfig(null as any)).rejects.toThrow();
    });
  });

  describe('getCaptchaConfig', () => {
    it('应返回存储的 CAPTCHA 配置', async () => {
      const mockConfig = {
        enabled: true,
        provider: 'hcaptcha',
        hcaptchaSiteKey: 'site-key',
        hcaptchaSecretKey: 'secret-key',
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
      };
      (getDb as any).mockResolvedValueOnce({ value: JSON.stringify(mockConfig) });

      const result = await getCaptchaConfig();

      expect(result.enabled).toBe(true);
      expect(result.provider).toBe('hcaptcha');
      expect(result.hcaptchaSiteKey).toBe('site-key');
    });

    it('无配置时应返回默认值', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await getCaptchaConfig();

      expect(result.enabled).toBe(false);
      expect(result.provider).toBe('none');
    });

    it('配置格式无效时应返回默认值', async () => {
      (getDb as any).mockResolvedValueOnce({ value: 'invalid-json' });

      const result = await getCaptchaConfig();

      expect(result.enabled).toBe(false);
    });
  });

  describe('setCaptchaConfig', () => {
    it('应成功保存 CAPTCHA 配置', async () => {
      const config = {
        enabled: true,
        provider: 'hcaptcha' as const,
        hcaptchaSiteKey: 'site-key',
        hcaptchaSecretKey: 'secret-key',
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
      };

      await setCaptchaConfig(config);

      expect(runDb).toHaveBeenCalled();
    });

    it('配置无效时应抛出异常', async () => {
      await expect(setCaptchaConfig({} as any)).rejects.toThrow('保存 CAPTCHA 配置失败。');
    });

    it('enabled 不是布尔值时应抛出异常', async () => {
      await expect(setCaptchaConfig({ enabled: 'true' } as any)).rejects.toThrow(
        '保存 CAPTCHA 配置失败。'
      );
    });
  });
});
