import { settingsService } from './settings.service';
import { AuditLogService } from '../audit/audit.service';
import { NotificationService } from '../notifications/notification.service';
import { ipBlacklistService } from '../auth/ip-blacklist.service';
import { exportConnectionsAsEncryptedZip } from '../services/import-export.service';
import { getErrorMessage, ErrorFactory } from '../utils/AppError';
import { asyncHandler } from '../utils/asyncHandler';
import { UpdateSidebarConfigDto, UpdateCaptchaSettingsDto } from '../types/settings.types';
import { UpdateAppearanceDto } from '../types/appearance.types';
import {
  getAppearanceSettings,
  updateAppearanceSettings as updateAppearanceSettingsInRepo,
} from '../appearance/appearance.repository';
import { logger, setLogLevel as setPinoLogLevel } from '../utils/logger';

const auditLogService = new AuditLogService();
const notificationService = new NotificationService();

type FocusShortcutConfig = {
  shortcut?: string;
};

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item: unknown) => typeof item === 'string');

const isFocusShortcutConfig = (value: unknown): value is FocusShortcutConfig => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  if (!('shortcut' in value)) {
    return true;
  }

  const shortcut = (value as { shortcut?: unknown }).shortcut;
  return shortcut === undefined || typeof shortcut === 'string';
};

const isShortcutRecord = (value: unknown): value is Record<string, FocusShortcutConfig> =>
  typeof value === 'object' &&
  value !== null &&
  Object.values(value).every((shortcut: unknown) => isFocusShortcutConfig(shortcut));

export const settingsController = {
  /**
   * 获取外观设置
   */
  getAppearanceSettings: asyncHandler(async (req, res) => {
    const settings = await getAppearanceSettings();
    res.json(settings);
  }),
  /**
   * 更新外观设置
   */
  updateAppearanceSettings: asyncHandler(async (req, res) => {
    const settingsDto: UpdateAppearanceDto = req.body;
    // 可在此处添加 DTO 验证逻辑
    if (typeof settingsDto !== 'object' || settingsDto === null) {
      res.status(400).json({
        success: false,
        error: '无效的请求体，应为 JSON 对象',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    const result = await updateAppearanceSettingsInRepo(settingsDto);
    if (result) {
      res.status(200).json({ message: '外观设置已成功更新' });
    } else {
      // 如果仓库层返回 false，可能表示没有实际更改或更新失败
      res.status(200).json({ message: '外观设置未发生更改或更新失败' });
    }
  }),
  /**
   * 获取所有设置项
   */
  getAllSettings: asyncHandler(async (req, res) => {
    const settings = await settingsService.getAllSettings();
    res.json(settings);
  }),

  /**
   * 批量更新设置项
   */
  updateSettings: asyncHandler(async (req, res) => {
    const settingsToUpdate: Record<string, string> = req.body;
    if (typeof settingsToUpdate !== 'object' || settingsToUpdate === null) {
      res.status(400).json({
        success: false,
        error: '无效的请求体，应为 JSON 对象',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    const allowedSettingsKeys = [
      'language',
      'ipWhitelist',
      'maxLoginAttempts',
      'loginBanDuration',
      'showPopupFileEditor',
      'shareFileEditorTabs',
      'ipWhitelistEnabled',
      'autoCopyOnSelect',
      'dockerStatusIntervalSeconds',
      'dockerDefaultExpand',
      'statusMonitorIntervalSeconds', // +++ 状态监控间隔键 +++
      'workspaceSidebarPersistent', // +++ 侧边栏固定键 +++
      'showPopupFileManager', // +++ 弹窗文件管理器设置键 +++
      'sidebarPaneWidths', // +++ 侧边栏宽度对象键 +++
      'fileManagerRowSizeMultiplier', // +++ 文件管理器行大小键 +++
      'fileManagerColWidths', // +++ 文件管理器列宽键 +++
      'commandInputSyncTarget', // +++ 命令输入同步目标键 +++
      'timezone', // 时区键
      'rdpModalWidth', //  RDP 模态框宽度键
      'rdpModalHeight', //  RDP 模态框高度键
      'vncModalWidth', //  VNC 模态框宽度键
      'vncModalHeight', //  VNC 模态框高度键
      'ipBlacklistEnabled', // <-- 添加 IP 黑名单启用键
      'layoutLocked', // +++ 布局锁定键 +++
      'terminalScrollbackLimit', // 终端回滚行数键
      'fileManagerShowDeleteConfirmation', // 文件管理器删除确认键
      'fileManagerSingleClickOpenFile', // 文件管理器单击打开文件键
      'terminalAutoWrapEnabled', // 终端自动换行开关
      'sshSuspendKeepAliveSeconds', // 挂起会话保活时长（秒）
      'terminalEnableRightClickPaste', // 终端右键粘贴键
      'showStatusMonitorIpAddress', // 添加状态监视器IP显示键 (与服务层和前端统一)
      'terminalOutputEnhancerEnabled', // 终端输出增强器开关
    ];
    const filteredSettings: Record<string, string> = {};
    for (const key of Object.keys(settingsToUpdate)) {
      if (allowedSettingsKeys.includes(key)) {
        filteredSettings[key] = settingsToUpdate[key];
      }
    }

    if (Object.keys(filteredSettings).length > 0) {
      await settingsService.setMultipleSettings(filteredSettings);
    }

    const updatedKeys = Object.keys(filteredSettings);
    if (updatedKeys.length > 0) {
      if (updatedKeys.includes('ipWhitelist') || updatedKeys.includes('ipWhitelistEnabled')) {
        auditLogService.logAction('IP_WHITELIST_UPDATED', { updatedKeys });
      } else {
        auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys });
        notificationService.sendNotification('SETTINGS_UPDATED', { updatedKeys }); // 添加通知调用
      }
    }
    res.status(200).json({ message: '设置已成功更新' });
  }),

  /**
   * 获取焦点切换顺序
   */
  getFocusSwitcherSequence: asyncHandler(async (req, res) => {
    const sequence = await settingsService.getFocusSwitcherSequence();
    res.json(sequence);
  }),

  /**
   * 设置焦点切换顺序
   */
  setFocusSwitcherSequence: asyncHandler(async (req, res) => {
    try {
      // +++ 修改：获取请求体并验证其是否符合 FocusSwitcherFullConfig 结构 +++
      const fullConfig = req.body;
      logger.debug('[SettingsController] 请求体 fullConfig:', JSON.stringify(fullConfig));

      // +++ 验证 FocusSwitcherFullConfig 结构 +++
      if (
        !(
          typeof fullConfig === 'object' &&
          fullConfig !== null &&
          Array.isArray(fullConfig.sequence) &&
          isStringArray(fullConfig.sequence) &&
          typeof fullConfig.shortcuts === 'object' &&
          fullConfig.shortcuts !== null &&
          isShortcutRecord(fullConfig.shortcuts)
        )
      ) {
        logger.warn('[SettingsController] 收到无效的完整焦点配置格式:', fullConfig);
        throw ErrorFactory.badRequest(
          '无效的请求体，必须是包含 sequence (string[]) 和 shortcuts (Record<string, {shortcut?: string}>) 的对象',
          'INVALID_REQUEST_BODY',
        );
      }

      // +++ 传递验证后的 fullConfig 给服务层 +++
      await settingsService.setFocusSwitcherSequence(fullConfig);

      res.status(200).json({ message: '焦点切换顺序已成功更新' });
    } catch (error: unknown) {
      const errMsg = getErrorMessage(error);
      if (errMsg === 'Invalid sequence format provided.') {
        throw ErrorFactory.badRequest('设置焦点切换顺序失败: 无效的格式', 'INVALID_FORMAT');
      }
      throw error;
    }
  }),

  /**
   * 获取导航栏可见性设置
   */
  getNavBarVisibility: asyncHandler(async (req, res) => {
    const isVisible = await settingsService.getNavBarVisibility();
    res.json({ visible: isVisible });
  }),

  /**
   * 设置导航栏可见性
   */
  setNavBarVisibility: asyncHandler(async (req, res) => {
    const { visible } = req.body;
    logger.debug('[SettingsController] 请求体 visible:', visible);

    if (typeof visible !== 'boolean') {
      logger.warn('[SettingsController] 收到无效的 visible 格式:', visible);
      res.status(400).json({
        success: false,
        error: '无效的请求体，"visible" 必须是一个布尔值',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    await settingsService.setNavBarVisibility(visible);

    res.status(200).json({ message: '导航栏可见性已成功更新' });
  }),

  /**
   * 获取布局树设置
   */
  getLayoutTree: asyncHandler(async (req, res) => {
    const layoutJson = await settingsService.getLayoutTree();
    if (layoutJson) {
      try {
        const layout = JSON.parse(layoutJson);
        res.json(layout);
      } catch (parseError: unknown) {
        throw ErrorFactory.badRequest('从数据库解析布局树 JSON 失败', getErrorMessage(parseError));
      }
    } else {
      res.json(null);
    }
  }),

  /**
   * 设置布局树
   */
  setLayoutTree: asyncHandler(async (req, res) => {
    try {
      const layoutTree = req.body;

      if (typeof layoutTree !== 'object' || layoutTree === null) {
        logger.warn('[SettingsController] 收到无效的布局树格式 (非对象):', layoutTree);
        throw ErrorFactory.badRequest(
          '无效的请求体，应为 JSON 对象格式的布局树',
          'INVALID_REQUEST_BODY',
        );
      }

      const layoutJson = JSON.stringify(layoutTree);

      await settingsService.setLayoutTree(layoutJson);

      // auditLogService.logAction('LAYOUT_TREE_UPDATED');

      res.status(200).json({ message: '布局树已成功更新' });
    } catch (error: unknown) {
      const errMsg = getErrorMessage(error);
      if (errMsg === 'Invalid layout tree JSON format.') {
        throw ErrorFactory.badRequest('设置布局树失败: 无效的 JSON 格式', 'INVALID_FORMAT');
      }
      throw error;
    }
  }),

  /**
   * 获取 IP 黑名单列表 (分页)
   */
  getIpBlacklist: asyncHandler(async (req, res) => {
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const offset = parseInt((req.query.offset as string) || '0', 10);
    const result = await ipBlacklistService.getBlacklist(limit, offset);
    res.json(result);
  }),

  /**
   * 从 IP 黑名单中删除一个 IP
   */
  deleteIpFromBlacklist: asyncHandler(async (req, res) => {
    const ipToDelete = req.params.ip;
    if (!ipToDelete) {
      res
        .status(400)
        .json({ success: false, error: '缺少要删除的 IP 地址', code: 'MISSING_PARAMETER' });
      return;
    }
    await ipBlacklistService.removeFromBlacklist(ipToDelete);
    res.status(200).json({ message: `IP 地址 ${ipToDelete} 已从黑名单中移除` });
  }),

  /**
   * 获取终端选中自动复制设置
   */
  getAutoCopyOnSelect: asyncHandler(async (req, res) => {
    const isEnabled = await settingsService.getAutoCopyOnSelect();
    res.json({ enabled: isEnabled });
  }),

  /**
   * 设置终端选中自动复制
   */
  setAutoCopyOnSelect: asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    logger.debug('[SettingsController] 请求体 enabled:', enabled);

    if (typeof enabled !== 'boolean') {
      logger.warn('[SettingsController] 收到无效的 enabled 格式:', enabled);
      res.status(400).json({
        success: false,
        error: '无效的请求体，"enabled" 必须是一个布尔值',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    await settingsService.setAutoCopyOnSelect(enabled);

    res.status(200).json({ message: '终端选中自动复制设置已成功更新' });
  }),

  /**
   * 获取侧栏配置
   */
  getSidebarConfig: asyncHandler(async (req, res) => {
    const config = await settingsService.getSidebarConfig();
    logger.debug('[SettingsController] 向客户端发送侧边栏配置:', config);
    res.json(config);
  }),

  /**
   * 设置侧栏配置
   */
  setSidebarConfig: asyncHandler(async (req, res) => {
    try {
      const configDto: UpdateSidebarConfigDto = req.body;
      logger.debug('[SettingsController] 请求体:', configDto);

      // --- DTO Validation (Basic) ---
      // More specific validation happens in the service layer
      if (
        !configDto ||
        typeof configDto !== 'object' ||
        !Array.isArray(configDto.left) ||
        !Array.isArray(configDto.right)
      ) {
        logger.warn('[SettingsController] 收到无效的侧边栏配置格式:', configDto);
        throw ErrorFactory.badRequest(
          '无效的请求体，应为包含 left 和 right 数组的 JSON 对象',
          'INVALID_REQUEST_BODY',
        );
      }

      await settingsService.setSidebarConfig(configDto);

      res.status(200).json({ message: '侧栏配置已成功更新' });
    } catch (error: unknown) {
      const errMsg = getErrorMessage(error);
      // 处理来自服务层的特定验证错误
      if (errMsg.includes('无效的面板名称') || errMsg.includes('无效的侧栏配置格式')) {
        throw ErrorFactory.badRequest(`设置侧栏配置失败: ${errMsg}`, 'VALIDATION_ERROR');
      }
      throw error;
    }
  }),

  /**
   * 获取公共 CAPTCHA 配置 (不含密钥)
   */
  getCaptchaConfig: asyncHandler(async (req, res) => {
    const fullConfig = await settingsService.getCaptchaConfig();

    const publicConfig = {
      enabled: fullConfig.enabled,
      provider: fullConfig.provider,
      hcaptchaSiteKey: fullConfig.hcaptchaSiteKey,
      recaptchaSiteKey: fullConfig.recaptchaSiteKey,
    };

    logger.debug('[SettingsController] 向客户端发送公共 CAPTCHA 配置:', publicConfig);
    res.json(publicConfig);
  }),

  /**
   * 设置 CAPTCHA 配置
   */
  setCaptchaConfig: asyncHandler(async (req, res) => {
    try {
      const configDto: UpdateCaptchaSettingsDto = req.body;
      logger.debug('[SettingsController] 请求体 (DTO, 密钥已屏蔽):', {
        ...configDto,
        hcaptchaSecretKey: '***',
        recaptchaSecretKey: '***',
      });

      if (!configDto || typeof configDto !== 'object') {
        logger.warn('[SettingsController] 收到无效的 CAPTCHA 配置格式 (非对象):', configDto);
        throw ErrorFactory.badRequest('无效的请求体，应为 JSON 对象', 'INVALID_REQUEST_BODY');
      }

      await settingsService.setCaptchaConfig(configDto);

      res.status(200).json({ message: 'CAPTCHA 配置已成功更新' });
    } catch (error: unknown) {
      const errMsg = getErrorMessage(error);
      // 处理来自服务层的特定验证错误
      if (errMsg.includes('无效的') || errMsg.includes('必须是')) {
        throw ErrorFactory.badRequest(`设置 CAPTCHA 配置失败: ${errMsg}`, 'VALIDATION_ERROR');
      }
      throw error;
    }
  }),

  // --- Show Connection Tags ---
  getShowConnectionTags: asyncHandler(async (req, res) => {
    const isEnabled = await settingsService.getShowConnectionTags();
    res.json({ enabled: isEnabled });
  }),

  setShowConnectionTags: asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    logger.debug('[SettingsController] 请求体 enabled:', enabled);

    if (typeof enabled !== 'boolean') {
      logger.warn('[SettingsController] 收到无效的 enabled 格式:', enabled);
      res.status(400).json({
        success: false,
        error: '无效的请求体，"enabled" 必须是一个布尔值',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    await settingsService.setShowConnectionTags(enabled);

    auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys: ['showConnectionTags'] });
    notificationService.sendNotification('SETTINGS_UPDATED', {
      updatedKeys: ['showConnectionTags'],
    });

    res.status(200).json({ message: '"显示连接标签"设置已成功更新' });
  }),

  // --- Show Quick Command Tags ---
  getShowQuickCommandTags: asyncHandler(async (req, res) => {
    const isEnabled = await settingsService.getShowQuickCommandTags();
    res.json({ enabled: isEnabled });
  }),

  setShowQuickCommandTags: asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    logger.debug('[SettingsController] 请求体 enabled:', enabled);

    if (typeof enabled !== 'boolean') {
      logger.warn('[SettingsController] 收到无效的 enabled 格式:', enabled);
      res.status(400).json({
        success: false,
        error: '无效的请求体，"enabled" 必须是一个布尔值',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    await settingsService.setShowQuickCommandTags(enabled);

    auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys: ['showQuickCommandTags'] });
    notificationService.sendNotification('SETTINGS_UPDATED', {
      updatedKeys: ['showQuickCommandTags'],
    });

    res.status(200).json({ message: '"显示快捷指令标签"设置已成功更新' });
  }),

  // --- Show Status Monitor IP Address ---
  getShowStatusMonitorIpAddress: asyncHandler(async (req, res) => {
    const isEnabled = await settingsService.getShowStatusMonitorIpAddress();
    res.json({ enabled: isEnabled });
  }),

  setShowStatusMonitorIpAddress: asyncHandler(async (req, res) => {
    const { enabled } = req.body;
    logger.debug('[SettingsController] 请求体 enabled:', enabled);

    if (typeof enabled !== 'boolean') {
      logger.warn('[SettingsController] 收到无效的 enabled 格式:', enabled);
      res.status(400).json({
        success: false,
        error: '无效的请求体，"enabled" 必须是一个布尔值',
        code: 'INVALID_REQUEST_BODY',
      });
      return;
    }

    await settingsService.setShowStatusMonitorIpAddress(enabled);

    auditLogService.logAction('SETTINGS_UPDATED', {
      updatedKeys: ['showStatusMonitorIpAddress'],
    });
    notificationService.sendNotification('SETTINGS_UPDATED', {
      updatedKeys: ['showStatusMonitorIpAddress'],
    });

    res.status(200).json({ message: '"显示状态监视器IP地址"设置已成功更新' });
  }),

  /**
   * 导出所有连接配置为加密的 ZIP 文件
   */
  exportAllConnections: asyncHandler(async (req, res) => {
    const passwordHeader = req.header('x-export-password');
    const password =
      typeof passwordHeader === 'string' && passwordHeader.trim() !== ''
        ? passwordHeader.trim()
        : undefined;
    const encryptedZipBuffer = await exportConnectionsAsEncryptedZip(true, password);

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="nexus_connections_export.zip"');
    res.send(encryptedZipBuffer);
  }),

  // --- 容器日志等级设置 ---
  /**
   * 获取当前容器日志等级
   */
  getLogLevel: asyncHandler(async (req, res) => {
    const level = await settingsService.getLogLevel();
    res.json({ level });
  }),

  /**
   * 设置容器日志等级
   */
  setLogLevel: asyncHandler(async (req, res) => {
    const { level } = req.body;
    const validLevels = ['debug', 'info', 'warn', 'error', 'silent'];

    if (!level || typeof level !== 'string' || !validLevels.includes(level)) {
      res.status(400).json({
        success: false,
        error: `无效的日志等级。必须是以下之一: ${validLevels.join(', ')}`,
        code: 'INVALID_PARAMETER',
      });
      return;
    }

    // 保存到数据库
    await settingsService.setLogLevel(level);
    // 立即更新运行时日志等级（单一 pino 引擎）
    setPinoLogLevel(level);

    auditLogService.logAction('SETTINGS_UPDATED', { updatedKeys: ['logLevel'], newValue: level });

    res.status(200).json({ message: '日志等级已成功更新', level });
  }),

  // --- 审计日志最大保留条数设置 ---
  /**
   * 获取审计日志最大保留条数
   */
  getAuditLogMaxEntries: asyncHandler(async (req, res) => {
    const maxEntries = await settingsService.getAuditLogMaxEntries();
    res.json({ maxEntries });
  }),

  /**
   * 设置审计日志最大保留条数
   */
  setAuditLogMaxEntries: asyncHandler(async (req, res) => {
    const { maxEntries } = req.body;

    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      res.status(400).json({
        success: false,
        error: '无效的最大条数，必须是正整数',
        code: 'INVALID_PARAMETER',
      });
      return;
    }

    await settingsService.setAuditLogMaxEntries(maxEntries);

    auditLogService.logAction('SETTINGS_UPDATED', {
      updatedKeys: ['auditLogMaxEntries'],
      newValue: maxEntries,
    });

    res.status(200).json({ message: '审计日志最大条数已成功更新', maxEntries });
  }),
};
