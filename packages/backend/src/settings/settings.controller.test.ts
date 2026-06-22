import { describe, it, expect, vi, beforeEach } from 'vitest';

import { settingsController } from './settings.controller';
import { settingsService } from './settings.service';

// --- Mock 依赖 ---

vi.mock('../audit/audit.service', () => ({
  AuditLogService: class {
    logAction = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('../notifications/notification.service', () => ({
  NotificationService: class {
    sendNotification = vi.fn().mockResolvedValue(undefined);
  },
}));

vi.mock('./settings.service', () => ({
  settingsService: {
    setMultipleSettings: vi.fn().mockResolvedValue(undefined),
    getAllSettings: vi.fn(),
    getSetting: vi.fn(),
    setSetting: vi.fn(),
    deleteSetting: vi.fn(),
    getFocusSwitcherSequence: vi.fn(),
    setFocusSwitcherSequence: vi.fn().mockResolvedValue(undefined),
    getNavBarVisibility: vi.fn(),
    setNavBarVisibility: vi.fn().mockResolvedValue(undefined),
    getLayoutTree: vi.fn(),
    setLayoutTree: vi.fn().mockResolvedValue(undefined),
    getAutoCopyOnSelect: vi.fn(),
    setAutoCopyOnSelect: vi.fn().mockResolvedValue(undefined),
    getSidebarConfig: vi.fn(),
    setSidebarConfig: vi.fn().mockResolvedValue(undefined),
    getCaptchaConfig: vi.fn(),
    setCaptchaConfig: vi.fn().mockResolvedValue(undefined),
    getShowConnectionTags: vi.fn(),
    setShowConnectionTags: vi.fn().mockResolvedValue(undefined),
    getShowQuickCommandTags: vi.fn(),
    setShowQuickCommandTags: vi.fn().mockResolvedValue(undefined),
    getShowStatusMonitorIpAddress: vi.fn(),
    setShowStatusMonitorIpAddress: vi.fn().mockResolvedValue(undefined),
    getLogLevel: vi.fn(),
    setLogLevel: vi.fn().mockResolvedValue(undefined),
    getAuditLogMaxEntries: vi.fn(),
    setAuditLogMaxEntries: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../auth/ip-blacklist.service', () => ({
  ipBlacklistService: {
    getBlacklist: vi.fn(),
    removeFromBlacklist: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../services/import-export.service', () => ({
  exportConnectionsAsEncryptedZip: vi.fn(),
}));

vi.mock('../appearance/appearance.repository', () => ({
  getAppearanceSettings: vi.fn(),
  updateAppearanceSettings: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  setLogLevel: vi.fn(),
}));

vi.mock('../utils/AppError', async () => {
  // 保留真实的 AppError 类，确保 instanceof 检查正常工作
  const actual = await vi.importActual<typeof import('../utils/AppError')>('../utils/AppError');
  return {
    ...actual,
    getErrorMessage: vi.fn((err: unknown) => (err instanceof Error ? err.message : String(err))),
  };
});

// --- 辅助函数 ---

/** 刷新微任务队列，等待 asyncHandler 中的 .catch(next) 执行完成 */
const flushMicrotasks = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function createMockRes() {
  const res: {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
    setHeader: ReturnType<typeof vi.fn>;
  } = {
    status: vi.fn(),
    json: vi.fn(),
    send: vi.fn(),
    setHeader: vi.fn(),
  };
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn().mockReturnValue(res);
  return res;
}

// --- 测试套件 ---

describe('settingsController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== updateSettings ==========

  describe('updateSettings', () => {
    it('允许保存 terminalOutputEnhancerEnabled=false 并过滤未知键', async () => {
      const req = {
        body: {
          ipWhitelist: '127.0.0.1',
          terminalOutputEnhancerEnabled: 'false',
          sshSuspendKeepAliveSeconds: '1800',
          notAllowedKey: 'should-be-filtered',
        },
      };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.updateSettings(req as any, res as any, next);

      expect(settingsService.setMultipleSettings).toHaveBeenCalledWith({
        ipWhitelist: '127.0.0.1',
        terminalOutputEnhancerEnabled: 'false',
        sshSuspendKeepAliveSeconds: '1800',
      });
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '设置已成功更新' });
      expect(next).not.toHaveBeenCalled();
    });

    it('当请求体不是对象时返回 400', async () => {
      const req = { body: null };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.updateSettings(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        error: '无效的请求体，应为 JSON 对象',
        code: 'INVALID_REQUEST_BODY',
      });
      expect(settingsService.setMultipleSettings).not.toHaveBeenCalled();
    });

    it('过滤所有非白名单键后不调用 setMultipleSettings', async () => {
      const req = { body: { unknownKey1: 'a', unknownKey2: 'b' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.updateSettings(req as any, res as any, next);

      expect(settingsService.setMultipleSettings).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '设置已成功更新' });
    });

    it('更新 ipWhitelist 时触发 IP_WHITELIST_UPDATED 审计日志', async () => {
      const req = { body: { ipWhitelist: '192.168.1.0/24' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.updateSettings(req as any, res as any, next);

      expect(settingsService.setMultipleSettings).toHaveBeenCalledWith({
        ipWhitelist: '192.168.1.0/24',
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('当 service 层抛出错误时传递给 next', async () => {
      const error = new Error('数据库写入失败');
      vi.mocked(settingsService.setMultipleSettings).mockRejectedValueOnce(error);

      const req = { body: { language: 'zh-CN' } };
      const res = createMockRes();
      const next = vi.fn();

      settingsController.updateSettings(req as any, res as any, next);
      await flushMicrotasks();

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ========== getAllSettings ==========

  describe('getAllSettings', () => {
    it('应该返回所有设置', async () => {
      const mockSettings = { language: 'zh-CN', maxLoginAttempts: '5' };
      vi.mocked(settingsService.getAllSettings).mockResolvedValueOnce(mockSettings);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getAllSettings(req, res as any, next);

      expect(settingsService.getAllSettings).toHaveBeenCalled();
      expect(res.json).toHaveBeenCalledWith(mockSettings);
      expect(next).not.toHaveBeenCalled();
    });

    it('当 service 层抛出错误时传递给 next', async () => {
      const error = new Error('读取设置失败');
      vi.mocked(settingsService.getAllSettings).mockRejectedValueOnce(error);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      settingsController.getAllSettings(req, res as any, next);
      await flushMicrotasks();

      expect(next).toHaveBeenCalledWith(error);
    });
  });

  // ========== getFocusSwitcherSequence ==========

  describe('getFocusSwitcherSequence', () => {
    it('应该返回焦点切换配置', async () => {
      const mockConfig = {
        sequence: ['commandInput', 'terminalSearch'],
        shortcuts: { commandInput: { shortcut: 'Ctrl+K' } },
      };
      vi.mocked(settingsService.getFocusSwitcherSequence).mockResolvedValueOnce(mockConfig);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getFocusSwitcherSequence(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith(mockConfig);
    });
  });

  describe('setFocusSwitcherSequence', () => {
    it('当请求体格式无效时返回 400', async () => {
      const req = { body: { sequence: 'not-an-array', shortcuts: {} } };
      const res = createMockRes();
      const next = vi.fn();

      settingsController.setFocusSwitcherSequence(req as any, res as any, next);
      await flushMicrotasks();

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(settingsService.setFocusSwitcherSequence).not.toHaveBeenCalled();
    });

    it('应该成功更新焦点切换配置', async () => {
      const req = {
        body: {
          sequence: ['commandInput'],
          shortcuts: { commandInput: { shortcut: 'Ctrl+K' } },
        },
      };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setFocusSwitcherSequence(req as any, res as any, next);

      expect(settingsService.setFocusSwitcherSequence).toHaveBeenCalledWith(req.body);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '焦点切换顺序已成功更新' });
    });
  });

  // ========== getNavBarVisibility / setNavBarVisibility ==========

  describe('getNavBarVisibility', () => {
    it('应该返回导航栏可见性', async () => {
      vi.mocked(settingsService.getNavBarVisibility).mockResolvedValueOnce(true);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getNavBarVisibility(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith({ visible: true });
    });
  });

  describe('setNavBarVisibility', () => {
    it('当 visible 不是布尔值时返回 400', async () => {
      const req = { body: { visible: 'yes' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setNavBarVisibility(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_REQUEST_BODY' }),
      );
      expect(settingsService.setNavBarVisibility).not.toHaveBeenCalled();
    });

    it('应该成功更新导航栏可见性', async () => {
      const req = { body: { visible: false } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setNavBarVisibility(req as any, res as any, next);

      expect(settingsService.setNavBarVisibility).toHaveBeenCalledWith(false);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '导航栏可见性已成功更新' });
    });
  });

  // ========== getLayoutTree / setLayoutTree ==========

  describe('getLayoutTree', () => {
    it('应该返回已解析的布局树 JSON', async () => {
      const layoutObj = { direction: 'row', children: [] };
      vi.mocked(settingsService.getLayoutTree).mockResolvedValueOnce(JSON.stringify(layoutObj));

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getLayoutTree(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith(layoutObj);
    });

    it('当布局树不存在时返回 null', async () => {
      vi.mocked(settingsService.getLayoutTree).mockResolvedValueOnce(null);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getLayoutTree(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith(null);
    });
  });

  describe('setLayoutTree', () => {
    it('当请求体不是对象时返回 400', async () => {
      const req = { body: 'invalid-string' };
      const res = createMockRes();
      const next = vi.fn();

      settingsController.setLayoutTree(req as any, res as any, next);
      await flushMicrotasks();

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(settingsService.setLayoutTree).not.toHaveBeenCalled();
    });

    it('应该成功保存布局树', async () => {
      const layoutTree = { direction: 'row', children: [] };
      const req = { body: layoutTree };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setLayoutTree(req as any, res as any, next);

      expect(settingsService.setLayoutTree).toHaveBeenCalledWith(JSON.stringify(layoutTree));
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '布局树已成功更新' });
    });
  });

  // ========== getAutoCopyOnSelect / setAutoCopyOnSelect ==========

  describe('getAutoCopyOnSelect', () => {
    it('应该返回自动复制设置状态', async () => {
      vi.mocked(settingsService.getAutoCopyOnSelect).mockResolvedValueOnce(true);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getAutoCopyOnSelect(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith({ enabled: true });
    });
  });

  describe('setAutoCopyOnSelect', () => {
    it('当 enabled 不是布尔值时返回 400', async () => {
      const req = { body: { enabled: 1 } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setAutoCopyOnSelect(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_REQUEST_BODY' }),
      );
      expect(settingsService.setAutoCopyOnSelect).not.toHaveBeenCalled();
    });

    it('应该成功设置自动复制', async () => {
      const req = { body: { enabled: true } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setAutoCopyOnSelect(req as any, res as any, next);

      expect(settingsService.setAutoCopyOnSelect).toHaveBeenCalledWith(true);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '终端选中自动复制设置已成功更新' });
    });
  });

  // ========== getIpBlacklist / deleteIpFromBlacklist ==========

  describe('getIpBlacklist', () => {
    it('应该返回 IP 黑名单列表', async () => {
      const mockResult = { entries: [{ ip: '1.2.3.4' }], total: 1 };
      const { ipBlacklistService } = await import('../auth/ip-blacklist.service');
      vi.mocked(ipBlacklistService.getBlacklist).mockResolvedValueOnce(mockResult as any);

      const req = { query: { limit: '10', offset: '0' } } as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getIpBlacklist(req, res as any, next);

      expect(ipBlacklistService.getBlacklist).toHaveBeenCalledWith(10, 0);
      expect(res.json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('deleteIpFromBlacklist', () => {
    it('当缺少 IP 参数时返回 400', async () => {
      const req = { params: {} } as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.deleteIpFromBlacklist(req, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'MISSING_PARAMETER' }));
    });

    it('应该成功从黑名单删除 IP', async () => {
      const { ipBlacklistService } = await import('../auth/ip-blacklist.service');

      const req = { params: { ip: '1.2.3.4' } } as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.deleteIpFromBlacklist(req, res as any, next);

      expect(ipBlacklistService.removeFromBlacklist).toHaveBeenCalledWith('1.2.3.4');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: 'IP 地址 1.2.3.4 已从黑名单中移除',
      });
    });
  });

  // ========== setSidebarConfig ==========

  describe('setSidebarConfig', () => {
    it('当请求体缺少 left/right 数组时返回 400', async () => {
      const req = { body: { left: 'invalid', right: [] } };
      const res = createMockRes();
      const next = vi.fn();

      settingsController.setSidebarConfig(req as any, res as any, next);
      await flushMicrotasks();

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(settingsService.setSidebarConfig).not.toHaveBeenCalled();
    });

    it('应该成功更新侧栏配置', async () => {
      const configDto = { left: ['connections'], right: ['terminal'] };
      const req = { body: configDto };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setSidebarConfig(req as any, res as any, next);

      expect(settingsService.setSidebarConfig).toHaveBeenCalledWith(configDto);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '侧栏配置已成功更新' });
    });
  });

  // ========== setCaptchaConfig ==========

  describe('setCaptchaConfig', () => {
    it('当请求体不是对象时返回 400', async () => {
      const req = { body: null };
      const res = createMockRes();
      const next = vi.fn();

      settingsController.setCaptchaConfig(req as any, res as any, next);
      await flushMicrotasks();

      expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 400 }));
      expect(settingsService.setCaptchaConfig).not.toHaveBeenCalled();
    });

    it('应该成功更新 CAPTCHA 配置', async () => {
      const configDto = { enabled: true, provider: 'hcaptcha' as const };
      const req = { body: configDto };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setCaptchaConfig(req as any, res as any, next);

      expect(settingsService.setCaptchaConfig).toHaveBeenCalledWith(configDto);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: 'CAPTCHA 配置已成功更新' });
    });
  });

  // ========== setShowConnectionTags / setShowQuickCommandTags ==========

  describe('setShowConnectionTags', () => {
    it('当 enabled 不是布尔值时返回 400', async () => {
      const req = { body: { enabled: 'yes' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setShowConnectionTags(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_REQUEST_BODY' }),
      );
      expect(settingsService.setShowConnectionTags).not.toHaveBeenCalled();
    });

    it('应该成功更新显示连接标签设置', async () => {
      const req = { body: { enabled: false } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setShowConnectionTags(req as any, res as any, next);

      expect(settingsService.setShowConnectionTags).toHaveBeenCalledWith(false);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '"显示连接标签"设置已成功更新' });
    });
  });

  describe('setShowQuickCommandTags', () => {
    it('当 enabled 不是布尔值时返回 400', async () => {
      const req = { body: { enabled: 123 } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setShowQuickCommandTags(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_REQUEST_BODY' }),
      );
    });

    it('应该成功更新显示快捷指令标签设置', async () => {
      const req = { body: { enabled: true } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setShowQuickCommandTags(req as any, res as any, next);

      expect(settingsService.setShowQuickCommandTags).toHaveBeenCalledWith(true);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '"显示快捷指令标签"设置已成功更新' });
    });
  });

  // ========== setShowStatusMonitorIpAddress ==========

  describe('setShowStatusMonitorIpAddress', () => {
    it('当 enabled 不是布尔值时返回 400', async () => {
      const req = { body: { enabled: 'true' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setShowStatusMonitorIpAddress(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'INVALID_REQUEST_BODY' }),
      );
    });

    it('应该成功更新显示状态监视器 IP 地址设置', async () => {
      const req = { body: { enabled: false } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setShowStatusMonitorIpAddress(req as any, res as any, next);

      expect(settingsService.setShowStatusMonitorIpAddress).toHaveBeenCalledWith(false);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '"显示状态监视器IP地址"设置已成功更新' });
    });
  });

  // ========== getLogLevel / setLogLevel ==========

  describe('getLogLevel', () => {
    it('应该返回当前日志等级', async () => {
      vi.mocked(settingsService.getLogLevel).mockResolvedValueOnce('warn');

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getLogLevel(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith({ level: 'warn' });
    });
  });

  describe('setLogLevel', () => {
    it('当日志等级无效时返回 400', async () => {
      const req = { body: { level: 'verbose' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setLogLevel(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
      expect(settingsService.setLogLevel).not.toHaveBeenCalled();
    });

    it('应该成功设置日志等级并更新运行时等级', async () => {
      const { setLogLevel: setPinoLogLevel } = await import('../utils/logger');

      const req = { body: { level: 'debug' } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setLogLevel(req as any, res as any, next);

      expect(settingsService.setLogLevel).toHaveBeenCalledWith('debug');
      expect(setPinoLogLevel).toHaveBeenCalledWith('debug');
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ message: '日志等级已成功更新', level: 'debug' });
    });
  });

  // ========== getAuditLogMaxEntries / setAuditLogMaxEntries ==========

  describe('getAuditLogMaxEntries', () => {
    it('应该返回审计日志最大条数', async () => {
      vi.mocked(settingsService.getAuditLogMaxEntries).mockResolvedValueOnce(10000);

      const req = {} as any;
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.getAuditLogMaxEntries(req, res as any, next);

      expect(res.json).toHaveBeenCalledWith({ maxEntries: 10000 });
    });
  });

  describe('setAuditLogMaxEntries', () => {
    it('当 maxEntries 不是正整数时返回 400', async () => {
      const req = { body: { maxEntries: -5 } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setAuditLogMaxEntries(req as any, res as any, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'INVALID_PARAMETER' }));
      expect(settingsService.setAuditLogMaxEntries).not.toHaveBeenCalled();
    });

    it('应该成功设置审计日志最大条数', async () => {
      const req = { body: { maxEntries: 20000 } };
      const res = createMockRes();
      const next = vi.fn();

      await settingsController.setAuditLogMaxEntries(req as any, res as any, next);

      expect(settingsService.setAuditLogMaxEntries).toHaveBeenCalledWith(20000);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        message: '审计日志最大条数已成功更新',
        maxEntries: 20000,
      });
    });
  });
});
