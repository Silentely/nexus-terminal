/**
 * Settings Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { settingsService, DEFAULT_AUDIT_LOG_MAX_ENTRIES } from './settings.service';
import {
  settingsRepository,
  getSidebarConfig,
  setSidebarConfig,
  getCaptchaConfig,
  setCaptchaConfig,
} from './settings.repository';

// Mock settings repository
vi.mock('./settings.repository', () => ({
  settingsRepository: {
    getAllSettings: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    deleteSetting: vi.fn(),
    setMultipleSettings: vi.fn(),
  },
  getSidebarConfig: vi.fn(),
  setSidebarConfig: vi.fn(),
  getCaptchaConfig: vi.fn(),
  setCaptchaConfig: vi.fn(),
}));

describe('Settings Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAllSettings', () => {
    it('应返回所有设置的键值对对象', async () => {
      const mockSettings = [
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
      ];
      vi.mocked(settingsRepository.getAllSettings).mockResolvedValueOnce(mockSettings);

      const result = await settingsService.getAllSettings();

      expect(result).toEqual({ key1: 'value1', key2: 'value2' });
    });

    it('无设置时应返回空对象', async () => {
      vi.mocked(settingsRepository.getAllSettings).mockResolvedValueOnce([]);

      const result = await settingsService.getAllSettings();

      expect(result).toEqual({});
    });
  });

  describe('getSetting', () => {
    it('应返回单个设置值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('test-value');

      const result = await settingsService.getSetting('testKey');

      expect(result).toBe('test-value');
      expect(settingsRepository.getSetting).toHaveBeenCalledWith('testKey');
    });
  });

  describe('setSetting', () => {
    it('应调用 repository 设置值', async () => {
      await settingsService.setSetting('key', 'value');

      expect(settingsRepository.setSetting).toHaveBeenCalledWith('key', 'value');
    });
  });

  describe('setMultipleSettings', () => {
    it('应调用 repository 批量设置', async () => {
      const settings = { key1: 'value1', key2: 'value2' };

      await settingsService.setMultipleSettings(settings);

      expect(settingsRepository.setMultipleSettings).toHaveBeenCalledWith(settings);
    });
  });

  describe('deleteSetting', () => {
    it('应调用 repository 删除设置', async () => {
      await settingsService.deleteSetting('testKey');

      expect(settingsRepository.deleteSetting).toHaveBeenCalledWith('testKey');
    });
  });

  describe('getIpWhitelistSettings', () => {
    it('应返回 IP 白名单设置', async () => {
      vi.mocked(settingsRepository.getSetting)
        .mockResolvedValueOnce('true')
        .mockResolvedValueOnce('192.168.1.1,10.0.0.0/8');

      const result = await settingsService.getIpWhitelistSettings();

      expect(result.enabled).toBe(true);
      expect(result.whitelist).toBe('192.168.1.1,10.0.0.0/8');
    });

    it('未启用时应返回 enabled: false', async () => {
      vi.mocked(settingsRepository.getSetting)
        .mockResolvedValueOnce('false')
        .mockResolvedValueOnce('');

      const result = await settingsService.getIpWhitelistSettings();

      expect(result.enabled).toBe(false);
    });

    it('白名单为 null 时应返回空字符串', async () => {
      vi.mocked(settingsRepository.getSetting)
        .mockResolvedValueOnce('true')
        .mockResolvedValueOnce(null);

      const result = await settingsService.getIpWhitelistSettings();

      expect(result.whitelist).toBe('');
    });
  });

  describe('updateIpWhitelistSettings', () => {
    it('应更新 IP 白名单设置', async () => {
      await settingsService.updateIpWhitelistSettings(true, '192.168.1.0/24');

      expect(settingsRepository.setSetting).toHaveBeenCalledTimes(2);
      expect(settingsRepository.setSetting).toHaveBeenCalledWith('ipWhitelistEnabled', 'true');
      expect(settingsRepository.setSetting).toHaveBeenCalledWith('ipWhitelist', '192.168.1.0/24');
    });
  });

  describe('isIpBlacklistEnabled', () => {
    it('值为 false 时应返回 false', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('false');

      const result = await settingsService.isIpBlacklistEnabled();

      expect(result).toBe(false);
    });

    it('值为 true 时应返回 true', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('true');

      const result = await settingsService.isIpBlacklistEnabled();

      expect(result).toBe(true);
    });

    it('值为 null 时应返回 true (默认启用)', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.isIpBlacklistEnabled();

      expect(result).toBe(true);
    });

    it('出错时应返回 true (默认启用)', async () => {
      vi.mocked(settingsRepository.getSetting).mockRejectedValueOnce(new Error('Database error'));

      const result = await settingsService.isIpBlacklistEnabled();

      expect(result).toBe(true);
    });
  });

  describe('getFocusSwitcherSequence', () => {
    it('应返回存储的焦点切换配置', async () => {
      const mockConfig = {
        sequence: ['quickCommandsSearch', 'commandInput'],
        shortcuts: { quickCommandsSearch: { shortcut: 'Ctrl+Q' } },
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(JSON.stringify(mockConfig));

      const result = await settingsService.getFocusSwitcherSequence();

      expect(result.sequence).toEqual(['quickCommandsSearch', 'commandInput']);
      expect(result.shortcuts).toBeDefined();
    });

    it('无配置时应返回默认值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getFocusSwitcherSequence();

      expect(result).toEqual({ sequence: [], shortcuts: {} });
    });

    it('配置格式无效时应返回默认值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('invalid-json');

      const result = await settingsService.getFocusSwitcherSequence();

      expect(result).toEqual({ sequence: [], shortcuts: {} });
    });
  });

  describe('setFocusSwitcherSequence', () => {
    it('应成功保存焦点切换配置', async () => {
      const config = {
        sequence: ['quickCommandsSearch'],
        shortcuts: {},
      };

      await settingsService.setFocusSwitcherSequence(config);

      expect(settingsRepository.setSetting).toHaveBeenCalled();
    });

    it('配置无效时应抛出异常', async () => {
      await expect(
        settingsService.setFocusSwitcherSequence({ sequence: 'not-array' } as any),
      ).rejects.toThrow('无效的焦点切换配置格式');
    });
  });

  describe('getNavBarVisibility', () => {
    it('值为 false 时应返回 false', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('false');

      const result = await settingsService.getNavBarVisibility();

      expect(result).toBe(false);
    });

    it('值为 null 时应返回 true (默认可见)', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getNavBarVisibility();

      expect(result).toBe(true);
    });
  });

  describe('setNavBarVisibility', () => {
    it('应成功设置导航栏可见性', async () => {
      await settingsService.setNavBarVisibility(false);

      expect(settingsRepository.setSetting).toHaveBeenCalledWith('navBarVisible', 'false');
    });
  });

  describe('getLayoutTree', () => {
    it('应返回布局树 JSON', async () => {
      const mockLayout = JSON.stringify({ type: 'container', children: [] });
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(mockLayout);

      const result = await settingsService.getLayoutTree();

      expect(result).toBe(mockLayout);
    });

    it('无布局时应返回 null', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getLayoutTree();

      expect(result).toBeNull();
    });
  });

  describe('setLayoutTree', () => {
    it('应成功保存布局树', async () => {
      const layoutJson = JSON.stringify({ type: 'container', children: [] });

      await settingsService.setLayoutTree(layoutJson);

      expect(settingsRepository.setSetting).toHaveBeenCalled();
    });

    it('无效 JSON 应抛出异常', async () => {
      await expect(settingsService.setLayoutTree('invalid-json')).rejects.toThrow(
        '无效的布局树 JSON 格式',
      );
    });
  });

  describe('getAutoCopyOnSelect', () => {
    it('值为 true 时应返回 true', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('true');

      const result = await settingsService.getAutoCopyOnSelect();

      expect(result).toBe(true);
    });

    it('值为 null 时应返回 false (默认禁用)', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getAutoCopyOnSelect();

      expect(result).toBe(false);
    });
  });

  describe('setAutoCopyOnSelect', () => {
    it('应成功设置自动复制选项', async () => {
      await settingsService.setAutoCopyOnSelect(true);

      expect(settingsRepository.setSetting).toHaveBeenCalledWith('autoCopyOnSelect', 'true');
    });
  });

  describe('getStatusMonitorIntervalSeconds', () => {
    it('应返回存储的间隔值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('10');

      const result = await settingsService.getStatusMonitorIntervalSeconds();

      expect(result).toBe(10);
    });

    it('无效值时应返回默认值 3', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('invalid');

      const result = await settingsService.getStatusMonitorIntervalSeconds();

      expect(result).toBe(3);
    });

    it('值为 null 时应返回默认值 3', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getStatusMonitorIntervalSeconds();

      expect(result).toBe(3);
    });
  });

  describe('setStatusMonitorIntervalSeconds', () => {
    it('应成功设置间隔值', async () => {
      await settingsService.setStatusMonitorIntervalSeconds(5);

      expect(settingsRepository.setSetting).toHaveBeenCalledWith(
        'statusMonitorIntervalSeconds',
        '5',
      );
    });

    it('值为 0 时应抛出异常', async () => {
      await expect(settingsService.setStatusMonitorIntervalSeconds(0)).rejects.toThrow(
        '无效的间隔值，必须为正整数',
      );
    });

    it('值为负数时应抛出异常', async () => {
      await expect(settingsService.setStatusMonitorIntervalSeconds(-1)).rejects.toThrow(
        '无效的间隔值，必须为正整数',
      );
    });
  });

  describe('getSidebarConfig', () => {
    it('应调用 repository 获取侧栏配置', async () => {
      const mockConfig = { left: ['connections'], right: [] };
      vi.mocked(getSidebarConfig).mockResolvedValueOnce(mockConfig);

      const result = await settingsService.getSidebarConfig();

      expect(result).toEqual(mockConfig);
      expect(getSidebarConfig).toHaveBeenCalled();
    });
  });

  describe('setSidebarConfig', () => {
    it('应验证并保存侧栏配置', async () => {
      const configDto = { left: ['connections'], right: ['dockerManager'] };
      vi.mocked(getCaptchaConfig).mockResolvedValueOnce({
        enabled: false,
        provider: 'none',
      });

      await settingsService.setSidebarConfig(configDto);

      expect(setSidebarConfig).toHaveBeenCalled();
    });

    it('配置格式无效时应抛出异常', async () => {
      await expect(settingsService.setSidebarConfig({} as any)).rejects.toThrow(
        '无效的侧栏配置格式',
      );
    });

    it('包含无效面板名称时应抛出异常', async () => {
      await expect(
        settingsService.setSidebarConfig({ left: ['invalidPane'], right: [] }),
      ).rejects.toThrow('包含无效的面板名称');
    });
  });

  describe('getCaptchaConfig', () => {
    it('应调用 repository 获取 CAPTCHA 配置', async () => {
      const mockConfig = { enabled: true, provider: 'hcaptcha' };
      vi.mocked(getCaptchaConfig).mockResolvedValueOnce(mockConfig);

      const result = await settingsService.getCaptchaConfig();

      expect(result).toEqual(mockConfig);
      expect(getCaptchaConfig).toHaveBeenCalled();
    });
  });

  describe('setCaptchaConfig', () => {
    it('应合并并保存 CAPTCHA 配置', async () => {
      const currentConfig = {
        enabled: false,
        provider: 'none',
        hcaptchaSiteKey: '',
        hcaptchaSecretKey: '',
        recaptchaSiteKey: '',
        recaptchaSecretKey: '',
      };
      vi.mocked(getCaptchaConfig).mockResolvedValueOnce(currentConfig);

      await settingsService.setCaptchaConfig({ enabled: true, provider: 'hcaptcha' });

      expect(setCaptchaConfig).toHaveBeenCalled();
    });

    it('enabled 非布尔值时应抛出异常', async () => {
      vi.mocked(getCaptchaConfig).mockResolvedValueOnce({
        enabled: false,
        provider: 'none',
      });

      await expect(settingsService.setCaptchaConfig({ enabled: 'true' as any })).rejects.toThrow(
        'captcha.enabled 必须是布尔值',
      );
    });

    it('provider 无效时应抛出异常', async () => {
      vi.mocked(getCaptchaConfig).mockResolvedValueOnce({
        enabled: false,
        provider: 'none',
      });

      await expect(
        settingsService.setCaptchaConfig({ provider: 'invalid' as any }),
      ).rejects.toThrow('无效的 CAPTCHA 提供商');
    });
  });

  describe('getShowConnectionTags', () => {
    it('值为 false 时应返回 false', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('false');

      const result = await settingsService.getShowConnectionTags();

      expect(result).toBe(false);
    });

    it('值为 null 时应返回 true (默认显示)', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getShowConnectionTags();

      expect(result).toBe(true);
    });
  });

  describe('setShowConnectionTags', () => {
    it('应成功设置连接标签显示', async () => {
      await settingsService.setShowConnectionTags(false);

      expect(settingsRepository.setSetting).toHaveBeenCalledWith('showConnectionTags', 'false');
    });
  });

  describe('getShowQuickCommandTags', () => {
    it('值为 false 时应返回 false', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('false');

      const result = await settingsService.getShowQuickCommandTags();

      expect(result).toBe(false);
    });
  });

  describe('setShowQuickCommandTags', () => {
    it('应成功设置快捷指令标签显示', async () => {
      await settingsService.setShowQuickCommandTags(true);

      expect(settingsRepository.setSetting).toHaveBeenCalledWith('showQuickCommandTags', 'true');
    });
  });

  describe('getShowStatusMonitorIpAddress', () => {
    it('值为 false 时应返回 false', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('false');

      const result = await settingsService.getShowStatusMonitorIpAddress();

      expect(result).toBe(false);
    });

    it('值为 null 时应返回 true (默认显示)', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);

      const result = await settingsService.getShowStatusMonitorIpAddress();

      expect(result).toBe(true);
    });
  });

  describe('setShowStatusMonitorIpAddress', () => {
    it('应成功设置状态监视器 IP 显示', async () => {
      await settingsService.setShowStatusMonitorIpAddress(false);

      expect(settingsRepository.setSetting).toHaveBeenCalledWith(
        'showStatusMonitorIpAddress',
        'false',
      );
    });
  });

  describe('getLogLevel', () => {
    it('存储值为有效日志等级时应原样返回', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('warn');
      const result = await settingsService.getLogLevel();
      expect(result).toBe('warn');
      expect(settingsRepository.getSetting).toHaveBeenCalledWith('logLevel');
    });

    it('存储值为无效字符串时应回退到 info', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('verbose');
      const result = await settingsService.getLogLevel();
      expect(result).toBe('info');
    });

    it('读取失败时应回退到 info', async () => {
      vi.mocked(settingsRepository.getSetting).mockRejectedValueOnce(new Error('boom'));
      const result = await settingsService.getLogLevel();
      expect(result).toBe('info');
    });
  });

  describe('setLogLevel', () => {
    it('传入无效日志等级时应抛出异常', async () => {
      await expect(settingsService.setLogLevel('verbose')).rejects.toThrow('无效的日志级别');
    });

    it('传入有效日志等级时应写入设置', async () => {
      await settingsService.setLogLevel('error');
      expect(settingsRepository.setSetting).toHaveBeenCalledWith('logLevel', 'error');
    });
  });

  describe('getAuditLogMaxEntries', () => {
    it('存储值为有效整数时应返回该数值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('1234');
      const result = await settingsService.getAuditLogMaxEntries();
      expect(result).toBe(1234);
      expect(settingsRepository.getSetting).toHaveBeenCalledWith('auditLogMaxEntries');
    });

    it('存储值为空时应回退到默认值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce(null);
      const result = await settingsService.getAuditLogMaxEntries();
      expect(result).toBe(DEFAULT_AUDIT_LOG_MAX_ENTRIES);
    });

    it('存储值为无效数字时应回退到默认值', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValueOnce('not-a-number');
      const result = await settingsService.getAuditLogMaxEntries();
      expect(result).toBe(DEFAULT_AUDIT_LOG_MAX_ENTRIES);
    });
  });

  describe('setAuditLogMaxEntries', () => {
    it('传入非正整数时应抛出异常', async () => {
      await expect(settingsService.setAuditLogMaxEntries(0)).rejects.toThrow('无效的最大条目值');
      await expect(settingsService.setAuditLogMaxEntries(-1)).rejects.toThrow('无效的最大条目值');
      await expect(settingsService.setAuditLogMaxEntries(1.2)).rejects.toThrow('无效的最大条目值');
    });

    it('传入有效值时应写入设置', async () => {
      await settingsService.setAuditLogMaxEntries(100);
      expect(settingsRepository.setSetting).toHaveBeenCalledWith('auditLogMaxEntries', '100');
    });
  });
});
