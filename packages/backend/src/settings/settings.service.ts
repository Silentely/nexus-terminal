import {
  settingsRepository,
  getSidebarConfig as getSidebarConfigFromRepo,
  setSidebarConfig as setSidebarConfigInRepo,
  getCaptchaConfig as getCaptchaConfigFromRepo,
  setCaptchaConfig as setCaptchaConfigInRepo,
} from './settings.repository';
import {
  SidebarConfig,
  PaneName,
  UpdateSidebarConfigDto,
  CaptchaSettings,
  UpdateCaptchaSettingsDto,
  CaptchaProvider,
} from '../types/settings.types';
import { logger } from '../utils/logger';
import { ErrorFactory } from '../utils/AppError';
import eventService, { AppEventType } from '../services/event.service';

// +++ 定义焦点切换完整配置接口 (与前端 store 保持一致) +++
interface FocusItemConfig {
  // 单个项目的配置
  shortcut?: string;
}
interface FocusSwitcherFullConfig {
  // 完整配置结构
  sequence: string[];
  shortcuts: Record<string, FocusItemConfig>;
}

// +++ 定义有效的焦点输入 ID 列表（与前端 focusSwitcher.store 保持一致） +++
const VALID_FOCUS_INPUT_IDS = [
  'commandHistorySearch',
  'quickCommandsSearch',
  'fileManagerSearch',
  'commandInput',
  'terminalSearch',
  'connectionListSearch',
  'fileEditorActive',
  'fileManagerPathInput',
] as const;

// 快捷键格式验证：支持 Ctrl/Alt/Shift/Meta + 字母/数字/功能键
const SHORTCUT_PATTERN =
  /^((Ctrl|Alt|Shift|Meta)\+)*([A-Za-z0-9]|F[1-9]|F1[0-2]|Escape|Enter|Tab|Space|ArrowUp|ArrowDown|ArrowLeft|ArrowRight)$/i;

const FOCUS_SEQUENCE_KEY = 'focusSwitcherSequence'; // 设置键保持不变
const NAV_BAR_VISIBLE_KEY = 'navBarVisible'; // 导航栏可见性设置键
const LAYOUT_TREE_KEY = 'layoutTree'; // 布局树设置键
const AUTO_COPY_ON_SELECT_KEY = 'autoCopyOnSelect'; // 终端选中自动复制设置键
const STATUS_MONITOR_INTERVAL_SECONDS_KEY = 'statusMonitorIntervalSeconds'; // 状态监控间隔设置键
const DEFAULT_STATUS_MONITOR_INTERVAL_SECONDS = 3; // 默认状态监控间隔
const IP_BLACKLIST_ENABLED_KEY = 'ipBlacklistEnabled'; // IP 黑名单启用设置键
const SHOW_CONNECTION_TAGS_KEY = 'showConnectionTags'; // 连接标签显示设置键
const SHOW_QUICK_COMMAND_TAGS_KEY = 'showQuickCommandTags'; // 快捷指令标签显示设置键
const SHOW_STATUS_MONITOR_IP_ADDRESS_KEY = 'showStatusMonitorIpAddress'; // 状态监视器IP显示设置键
const LOG_LEVEL_KEY = 'logLevel'; // 容器日志等级设置键
const AUDIT_LOG_MAX_ENTRIES_KEY = 'auditLogMaxEntries'; // 审计日志最大条数设置键
export const DEFAULT_AUDIT_LOG_MAX_ENTRIES = 50000; // 默认审计日志最大条数

export const settingsService = {
  /**
   * 获取所有设置项
   * @returns 返回包含所有设置项的键值对记录
   */
  async getAllSettings(): Promise<Record<string, string>> {
    // logger.info('[Service] Calling repository.getAllSettings...');
    const settingsArray = await settingsRepository.getAllSettings();
    // logger.info('[Service] Got settings array from repository:', JSON.stringify(settingsArray));
    const settingsRecord: Record<string, string> = {};
    settingsArray.forEach((setting) => {
      settingsRecord[setting.key] = setting.value;
    });
    return settingsRecord;
  },

  /**
   * 获取单个设置项的值
   * @param key 设置项的键
   * @returns 返回设置项的值，如果不存在则返回 null
   */
  async getSetting(key: string): Promise<string | null> {
    return settingsRepository.getSetting(key);
  },

  /**
   * 设置单个设置项的值 (如果键已存在则更新)
   * @param key 设置项的键
   * @param value 设置项的值
   */
  async setSetting(key: string, value: string): Promise<void> {
    await settingsRepository.setSetting(key, value);
  },

  /**
   * 批量设置多个设置项的值
   * @param settings 包含多个设置项键值对的对象
   */
  async setMultipleSettings(settings: Record<string, string>): Promise<void> {
    logger.debug(
      '[Service] Calling repository.setMultipleSettings with:',
      JSON.stringify(settings),
    );
    await settingsRepository.setMultipleSettings(settings);
    eventService.emitEvent(AppEventType.SettingsUpdated, {
      details: { keys: Object.keys(settings) },
    });
    logger.debug('[Service] Finished repository.setMultipleSettings.');
  },

  /**
   * 删除单个设置项
   * @param key 要删除的设置项的键
   */
  async deleteSetting(key: string): Promise<void> {
    await settingsRepository.deleteSetting(key);
  },

  /**
   * 获取 IP 白名单设置
   * @returns 返回包含启用状态和白名单列表的对象
   */
  async getIpWhitelistSettings(): Promise<{ enabled: boolean; whitelist: string }> {
    const enabledStr = await settingsRepository.getSetting('ipWhitelistEnabled');
    const whitelist = await settingsRepository.getSetting('ipWhitelist');
    return {
      enabled: enabledStr === 'true',
      whitelist: whitelist ?? '',
    };
  },

  /**
   * 更新 IP 白名单设置
   * @param enabled 是否启用 IP 白名单
   * @param whitelist 允许的 IP 地址/CIDR 列表 (字符串形式)
   */
  async updateIpWhitelistSettings(enabled: boolean, whitelist: string): Promise<void> {
    await Promise.all([
      settingsRepository.setSetting('ipWhitelistEnabled', String(enabled)),
      settingsRepository.setSetting('ipWhitelist', whitelist),
    ]);
  },

  /**
   * 检查 IP 黑名单功能是否已启用
   * @returns 返回是否启用 (boolean)，如果未设置则默认为 true
   */
  async isIpBlacklistEnabled(): Promise<boolean> {
    logger.debug(`[Service] Attempting to get setting for key: ${IP_BLACKLIST_ENABLED_KEY}`);
    try {
      const enabledStr = await settingsRepository.getSetting(IP_BLACKLIST_ENABLED_KEY);
      logger.debug(
        `[Service] Raw value from repository for ${IP_BLACKLIST_ENABLED_KEY}:`,
        enabledStr,
      );
      // 如果设置存在且值为 'false'，则返回 false，否则都返回 true (包括未设置的情况)
      return enabledStr !== 'false';
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting IP blacklist enabled setting (key: ${IP_BLACKLIST_ENABLED_KEY}):`,
        error,
      );
      // 出错时返回默认值 true (安全起见，默认启用)
      return true;
    }
  },

  /**
   * 获取焦点切换顺序
   * @returns 返回存储的完整焦点切换配置对象，如果未设置或无效则返回默认空配置
   */
  async getFocusSwitcherSequence(): Promise<FocusSwitcherFullConfig> {
    // +++ 更新返回类型 +++
    logger.debug(`[Service] Attempting to get setting for key: ${FOCUS_SEQUENCE_KEY}`);
    const defaultConfig: FocusSwitcherFullConfig = { sequence: [], shortcuts: {} }; // 默认值
    try {
      const configJson = await settingsRepository.getSetting(FOCUS_SEQUENCE_KEY);
      logger.debug(
        { key: FOCUS_SEQUENCE_KEY, raw: configJson },
        '[Service] Raw value from repository',
      );
      if (configJson) {
        const config = JSON.parse(configJson);
        // +++ 验证 FocusSwitcherFullConfig 结构 +++
        if (
          typeof config === 'object' &&
          config !== null &&
          Array.isArray(config.sequence) &&
          config.sequence.every((item: unknown) => typeof item === 'string') &&
          typeof config.shortcuts === 'object' &&
          config.shortcuts !== null &&
          Object.values(config.shortcuts).every(
            (sc: unknown) =>
              typeof sc === 'object' &&
              sc !== null &&
              (!('shortcut' in sc) || typeof (sc as { shortcut?: unknown }).shortcut === 'string'),
          )
        ) {
          logger.debug({ config }, '[Service] Fetched and validated full focus switcher config');
          return config as FocusSwitcherFullConfig;
        }
        logger.warn(
          '[Service] Invalid full focus switcher config format found in settings. Returning default.',
        );
      } else {
        logger.debug('[Service] No focus switcher config found in settings. Returning default.');
      }
    } catch (error: unknown) {
      logger.error(
        `[Service] Error parsing full focus switcher config from settings (key: ${FOCUS_SEQUENCE_KEY}):`,
        error,
      );
    }
    logger.debug({ config: defaultConfig }, '[Service] Returning default focus config');
    return defaultConfig;
  },

  /**
   * 设置完整的焦点切换配置
   * @param fullConfig 包含 sequence 和 shortcuts 的完整配置对象
   */
  async setFocusSwitcherSequence(fullConfig: FocusSwitcherFullConfig): Promise<void> {
    // +++ 更新参数类型 +++
    logger.debug(
      '[Service] setFocusSwitcherSequence called with full config:',
      JSON.stringify(fullConfig),
    );
    // +++ 验证 FocusSwitcherFullConfig 结构 (控制器层已做基本验证) +++
    if (
      !(
        typeof fullConfig === 'object' &&
        fullConfig !== null &&
        Array.isArray(fullConfig.sequence) &&
        fullConfig.sequence.every((item: unknown) => typeof item === 'string') &&
        typeof fullConfig.shortcuts === 'object' &&
        fullConfig.shortcuts !== null &&
        Object.values(fullConfig.shortcuts).every(
          (sc: unknown) =>
            typeof sc === 'object' &&
            sc !== null &&
            (!('shortcut' in sc) || typeof (sc as { shortcut?: unknown }).shortcut === 'string'),
        )
      )
    ) {
      logger.error(
        '[Service] Attempted to save invalid full focus switcher config format:',
        fullConfig,
      );
      throw ErrorFactory.badRequest('无效的焦点切换配置格式。');
    }

    // +++ 验证 sequence 中的每个 id 是否为有效的焦点输入 ID +++
    const invalidSequenceIds = fullConfig.sequence.filter(
      (id) => !(VALID_FOCUS_INPUT_IDS as readonly string[]).includes(id),
    );
    if (invalidSequenceIds.length > 0) {
      logger.error(
        `[Service] Invalid focus input IDs in sequence: ${invalidSequenceIds.join(', ')}`,
      );
      throw ErrorFactory.badRequest(
        `序列中包含无效的焦点输入 ID: ${invalidSequenceIds.join(', ')}`,
      );
    }

    // +++ 验证 shortcuts 中的每个 key 是否为有效的焦点输入 ID +++
    const invalidShortcutKeys = Object.keys(fullConfig.shortcuts).filter(
      (key) => !(VALID_FOCUS_INPUT_IDS as readonly string[]).includes(key),
    );
    if (invalidShortcutKeys.length > 0) {
      logger.error(
        `[Service] Invalid focus input IDs in shortcuts: ${invalidShortcutKeys.join(', ')}`,
      );
      throw ErrorFactory.badRequest(
        `快捷键中包含无效的焦点输入 ID: ${invalidShortcutKeys.join(', ')}`,
      );
    }

    // +++ 验证 shortcuts 中的快捷键格式是否有效 +++
    const invalidShortcuts: string[] = [];
    for (const [key, config] of Object.entries(fullConfig.shortcuts)) {
      if (config.shortcut && !SHORTCUT_PATTERN.test(config.shortcut)) {
        invalidShortcuts.push(`${key}: "${config.shortcut}"`);
      }
    }
    if (invalidShortcuts.length > 0) {
      logger.warn(
        `[Service] Invalid shortcut format(s): ${invalidShortcuts.join(', ')}. Shortcuts should follow pattern like "Ctrl+K", "Alt+Shift+F", etc.`,
      );
      // 对于快捷键格式，仅警告而不阻止保存（允许用户自定义格式）
    }

    try {
      const configJson = JSON.stringify(fullConfig); // +++ 序列化完整结构 +++
      logger.debug(
        `[Service] Attempting to save setting. Key: ${FOCUS_SEQUENCE_KEY}, Value: ${configJson}`,
      );
      await settingsRepository.setSetting(FOCUS_SEQUENCE_KEY, configJson);
      logger.debug(`[Service] Successfully saved setting for key: ${FOCUS_SEQUENCE_KEY}`);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${FOCUS_SEQUENCE_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存焦点切换序列失败');
    }
  },

  /**
   * 获取导航栏可见性设置
   * @returns 返回导航栏是否可见 (boolean)，如果未设置则默认为 true
   */
  async getNavBarVisibility(): Promise<boolean> {
    logger.debug(`[Service] Attempting to get setting for key: ${NAV_BAR_VISIBLE_KEY}`);
    try {
      const visibleStr = await settingsRepository.getSetting(NAV_BAR_VISIBLE_KEY);
      logger.debug(
        { key: NAV_BAR_VISIBLE_KEY, raw: visibleStr },
        '[Service] Raw value from repository',
      );
      // 如果设置存在且值为 'false'，则返回 false，否则都返回 true (包括未设置的情况)
      return visibleStr !== 'false';
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting nav bar visibility setting (key: ${NAV_BAR_VISIBLE_KEY}):`,
        error,
      );
      // 出错时返回默认值 true
      return true;
    }
  },

  /**
   * 设置导航栏可见性
   * @param visible 是否可见 (boolean)
   */
  async setNavBarVisibility(visible: boolean): Promise<void> {
    logger.debug(`[Service] setNavBarVisibility called with: ${visible}`);
    try {
      const visibleStr = String(visible); // 将布尔值转换为 'true' 或 'false'
      logger.debug(
        `[Service] Attempting to save setting. Key: ${NAV_BAR_VISIBLE_KEY}, Value: ${visibleStr}`,
      );
      await settingsRepository.setSetting(NAV_BAR_VISIBLE_KEY, visibleStr);
      logger.debug(`[Service] Successfully saved setting for key: ${NAV_BAR_VISIBLE_KEY}`);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${NAV_BAR_VISIBLE_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存导航栏可见性设置失败');
    }
  },

  /**
   * 获取布局树设置
   * @returns 返回存储的布局树 JSON 字符串，如果未设置则返回 null
   */
  async getLayoutTree(): Promise<string | null> {
    logger.debug(`[Service] Attempting to get setting for key: ${LAYOUT_TREE_KEY}`);
    try {
      const layoutJson = await settingsRepository.getSetting(LAYOUT_TREE_KEY);
      logger.debug(
        { key: LAYOUT_TREE_KEY, raw: layoutJson ? `${layoutJson.substring(0, 100)}...` : null },
        '[Service] Raw value from repository (truncated)',
      );
      return layoutJson; // 直接返回 JSON 字符串或 null
    } catch (error: unknown) {
      logger.error(`[Service] Error getting layout tree setting (key: ${LAYOUT_TREE_KEY}):`, error);
      return null; // 出错时返回 null
    }
  },

  /**
   * 设置布局树
   * @param layoutJson 布局树的 JSON 字符串
   */
  async setLayoutTree(layoutJson: string): Promise<void> {
    logger.debug(
      `[Service] setLayoutTree called with JSON (first 100 chars): ${layoutJson.substring(0, 100)}...`,
    );
    // 可选：在这里添加 JSON 格式验证
    try {
      JSON.parse(layoutJson); // 尝试解析以验证格式
    } catch (error: unknown) {
      logger.error('[Service] Invalid JSON format provided for layout tree:', error);
      throw ErrorFactory.badRequest('无效的布局树 JSON 格式。');
    }

    try {
      logger.debug(`[Service] Attempting to save setting. Key: ${LAYOUT_TREE_KEY}`);
      await settingsRepository.setSetting(LAYOUT_TREE_KEY, layoutJson);
      logger.debug(`[Service] Successfully saved setting for key: ${LAYOUT_TREE_KEY}`);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${LAYOUT_TREE_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存布局树设置失败');
    }
  },

  /**
   * 获取终端选中自动复制设置
   * @returns 返回是否启用该功能 (boolean)，如果未设置则默认为 false
   */
  async getAutoCopyOnSelect(): Promise<boolean> {
    logger.debug(`[Service] Attempting to get setting for key: ${AUTO_COPY_ON_SELECT_KEY}`);
    try {
      const enabledStr = await settingsRepository.getSetting(AUTO_COPY_ON_SELECT_KEY);
      logger.debug(
        `[Service] Raw value from repository for ${AUTO_COPY_ON_SELECT_KEY}:`,
        enabledStr,
      );
      // 如果设置存在且值为 'true'，则返回 true，否则都返回 false (包括未设置或值为 'false' 的情况)
      return enabledStr === 'true';
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting auto copy on select setting (key: ${AUTO_COPY_ON_SELECT_KEY}):`,
        error,
      );
      // 出错时返回默认值 false
      return false;
    }
  },

  /**
   * 设置终端选中自动复制
   * @param enabled 是否启用 (boolean)
   */
  async setAutoCopyOnSelect(enabled: boolean): Promise<void> {
    logger.debug(`[Service] setAutoCopyOnSelect called with: ${enabled}`);
    try {
      const enabledStr = String(enabled); // 将布尔值转换为 'true' 或 'false'
      logger.debug(
        `[Service] Attempting to save setting. Key: ${AUTO_COPY_ON_SELECT_KEY}, Value: ${enabledStr}`,
      );
      await settingsRepository.setSetting(AUTO_COPY_ON_SELECT_KEY, enabledStr);
      logger.debug(`[Service] Successfully saved setting for key: ${AUTO_COPY_ON_SELECT_KEY}`);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${AUTO_COPY_ON_SELECT_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存自动复制设置失败');
    }
  },

  /**
   * 获取状态监控轮询间隔 (秒)
   * @returns 返回间隔秒数 (number)，如果未设置或无效则返回默认值
   */
  async getStatusMonitorIntervalSeconds(): Promise<number> {
    logger.debug(
      `[Service] Attempting to get setting for key: ${STATUS_MONITOR_INTERVAL_SECONDS_KEY}`,
    );
    try {
      const intervalStr = await settingsRepository.getSetting(STATUS_MONITOR_INTERVAL_SECONDS_KEY);
      logger.debug(
        `[Service] Raw value from repository for ${STATUS_MONITOR_INTERVAL_SECONDS_KEY}:`,
        intervalStr,
      );
      if (intervalStr) {
        const intervalNum = parseInt(intervalStr, 10);
        // 验证是否为正整数
        if (!Number.isNaN(intervalNum) && intervalNum > 0) {
          return intervalNum;
        }
        logger.warn(
          `[Service] Invalid status monitor interval value found ('${intervalStr}'). Returning default.`,
        );
      } else {
        logger.debug(`[Service] No status monitor interval found in settings. Returning default.`);
      }
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting status monitor interval setting (key: ${STATUS_MONITOR_INTERVAL_SECONDS_KEY}):`,
        error,
      );
    }
    // 返回默认值
    return DEFAULT_STATUS_MONITOR_INTERVAL_SECONDS;
  },

  /**
   * 设置状态监控轮询间隔 (秒)
   * @param interval 间隔秒数 (number)
   */
  async setStatusMonitorIntervalSeconds(interval: number): Promise<void> {
    logger.debug(`[Service] setStatusMonitorIntervalSeconds called with: ${interval}`);
    // 验证输入是否为正整数
    if (!Number.isInteger(interval) || interval <= 0) {
      logger.error(`[Service] Attempted to save invalid status monitor interval: ${interval}`);
      throw ErrorFactory.badRequest('无效的间隔值，必须为正整数。');
    }
    try {
      const intervalStr = String(interval);
      logger.debug(
        `[Service] Attempting to save setting. Key: ${STATUS_MONITOR_INTERVAL_SECONDS_KEY}, Value: ${intervalStr}`,
      );
      await settingsRepository.setSetting(STATUS_MONITOR_INTERVAL_SECONDS_KEY, intervalStr);
      logger.debug(
        `[Service] Successfully saved setting for key: ${STATUS_MONITOR_INTERVAL_SECONDS_KEY}`,
      );
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${STATUS_MONITOR_INTERVAL_SECONDS_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存状态监控间隔设置失败');
    }
  },

  // --- Sidebar Config Specific Functions ---

  /**
   * 获取侧栏配置
   * @returns Promise<SidebarConfig>
   */
  async getSidebarConfig(): Promise<SidebarConfig> {
    logger.debug('[SettingsService] Getting sidebar config...');
    // Directly call the specific repository function
    const config = await getSidebarConfigFromRepo();
    logger.debug('[SettingsService] Returning sidebar config:', config);
    return config;
  },

  /**
   * 设置侧栏配置
   * @param configDto - The sidebar configuration object from DTO
   * @returns Promise<void>
   */
  async setSidebarConfig(configDto: UpdateSidebarConfigDto): Promise<void> {
    logger.debug('[SettingsService] Setting sidebar config:', configDto);

    // --- Validation ---
    if (
      !configDto ||
      typeof configDto !== 'object' ||
      !Array.isArray(configDto.left) ||
      !Array.isArray(configDto.right)
    ) {
      throw ErrorFactory.badRequest('无效的侧栏配置格式。必须包含 left 和 right 数组。');
    }

    // Validate PaneName (using the type imported)
    const validPaneNames: Set<PaneName> = new Set([
      'connections',
      'terminal',
      'commandBar',
      'fileManager',
      'editor',
      'statusMonitor',
      'commandHistory',
      'quickCommands',
      'dockerManager',
      'suspendedSshSessions',
      'aiAssistant',
      'batchExec',
    ]);

    const validatePaneArray = (arr: unknown[], side: string) => {
      if (!arr.every((item) => typeof item === 'string' && validPaneNames.has(item as PaneName))) {
        const invalidItems = arr.filter(
          (item) => typeof item !== 'string' || !validPaneNames.has(item as PaneName),
        );
        throw ErrorFactory.badRequest(
          `侧栏配置 (${side}) 包含无效的面板名称: ${invalidItems.join(', ')}`,
        );
      }
    };

    validatePaneArray(configDto.left, 'left');
    validatePaneArray(configDto.right, 'right');

    // Prevent duplicates (optional, uncomment if needed)
    // const allPanes = [...configDto.left, ...configDto.right];
    // const uniquePanes = new Set(allPanes);
    // if (allPanes.length !== uniquePanes.size) {
    //     throw new Error('侧栏配置中不允许包含重复的面板。');
    // }

    // Prepare the data in the exact SidebarConfig format expected by the repo
    const configToSave: SidebarConfig = {
      left: configDto.left,
      right: configDto.right,
    };

    // Directly call the specific repository function
    await setSidebarConfigInRepo(configToSave);
    logger.info('[SettingsService] Sidebar config successfully set.');
  }, // <-- Add comma here

  // --- CAPTCHA Settings Specific Functions ---

  /**
   * 获取 CAPTCHA 配置
   * @returns Promise<CaptchaSettings>
   */
  async getCaptchaConfig(): Promise<CaptchaSettings> {
    logger.debug('[SettingsService] Getting CAPTCHA config...');
    // Directly call the specific repository function
    const config = await getCaptchaConfigFromRepo();
    // Mask secret keys before logging
    const maskedConfig = { ...config, hcaptchaSecretKey: '***', recaptchaSecretKey: '***' };
    logger.debug('[SettingsService] Returning CAPTCHA config:', maskedConfig);
    return config;
  },

  /**
   * 设置 CAPTCHA 配置
   * @param configDto - The CAPTCHA configuration object from DTO
   * @returns Promise<void>
   */
  async setCaptchaConfig(configDto: UpdateCaptchaSettingsDto): Promise<void> {
    logger.debug('[SettingsService] Setting CAPTCHA config (DTO):', {
      ...configDto,
      hcaptchaSecretKey: '***',
      recaptchaSecretKey: '***',
    }); // Mask secrets in log

    // --- Validation ---
    if (!configDto || typeof configDto !== 'object') {
      throw ErrorFactory.badRequest('无效的 CAPTCHA 配置格式。');
    }

    // Fetch the current settings to merge with the DTO
    const currentConfig = await getCaptchaConfigFromRepo();
    const configToSave: CaptchaSettings = { ...currentConfig };

    // Validate and update individual fields from DTO
    if (configDto.enabled !== undefined) {
      if (typeof configDto.enabled !== 'boolean')
        throw ErrorFactory.badRequest('captcha.enabled 必须是布尔值。');
      configToSave.enabled = configDto.enabled;
    }
    if (configDto.provider !== undefined) {
      const validProviders: CaptchaProvider[] = ['hcaptcha', 'recaptcha', 'none'];
      if (!validProviders.includes(configDto.provider))
        throw ErrorFactory.badRequest(`无效的 CAPTCHA 提供商: ${configDto.provider}`);
      configToSave.provider = configDto.provider;
    }
    if (configDto.hcaptchaSiteKey !== undefined) {
      if (typeof configDto.hcaptchaSiteKey !== 'string')
        throw ErrorFactory.badRequest('hcaptchaSiteKey 必须是字符串。');
      configToSave.hcaptchaSiteKey = configDto.hcaptchaSiteKey;
    }
    if (configDto.hcaptchaSecretKey !== undefined) {
      if (typeof configDto.hcaptchaSecretKey !== 'string')
        throw ErrorFactory.badRequest('hcaptchaSecretKey 必须是字符串。');
      configToSave.hcaptchaSecretKey = configDto.hcaptchaSecretKey;
    }
    if (configDto.recaptchaSiteKey !== undefined) {
      if (typeof configDto.recaptchaSiteKey !== 'string')
        throw ErrorFactory.badRequest('recaptchaSiteKey 必须是字符串。');
      configToSave.recaptchaSiteKey = configDto.recaptchaSiteKey;
    }
    if (configDto.recaptchaSecretKey !== undefined) {
      if (typeof configDto.recaptchaSecretKey !== 'string')
        throw ErrorFactory.badRequest('recaptchaSecretKey 必须是字符串。');
      configToSave.recaptchaSecretKey = configDto.recaptchaSecretKey;
    }

    // Ensure consistency: if disabled, provider should ideally be 'none' (optional enforcement)
    // if (!configToSave.enabled) {
    //     configToSave.provider = 'none';
    // }

    // Directly call the specific repository function with the full, validated config
    await setCaptchaConfigInRepo(configToSave);
    logger.info('[SettingsService] CAPTCHA config successfully set.');
  }, // <-- Add comma here

  // --- Show Connection Tags ---
  async getShowConnectionTags(): Promise<boolean> {
    logger.debug(`[Service] Attempting to get setting for key: ${SHOW_CONNECTION_TAGS_KEY}`);
    try {
      const valueStr = await settingsRepository.getSetting(SHOW_CONNECTION_TAGS_KEY);
      logger.debug(
        `[Service] Raw value from repository for ${SHOW_CONNECTION_TAGS_KEY}:`,
        valueStr,
      );
      // 默认显示，所以只有当值为 'false' 时才返回 false
      return valueStr !== 'false';
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting show connection tags setting (key: ${SHOW_CONNECTION_TAGS_KEY}):`,
        error,
      );
      return true;
    }
  },

  async setShowConnectionTags(enabled: boolean): Promise<void> {
    logger.debug(`[Service] setShowConnectionTags called with: ${enabled}`);
    try {
      const valueStr = String(enabled);
      logger.debug(
        `[Service] Attempting to save setting. Key: ${SHOW_CONNECTION_TAGS_KEY}, Value: ${valueStr}`,
      );
      await settingsRepository.setSetting(SHOW_CONNECTION_TAGS_KEY, valueStr);
      logger.debug(`[Service] Successfully saved setting for key: ${SHOW_CONNECTION_TAGS_KEY}`);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${SHOW_CONNECTION_TAGS_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存连接标签显示设置失败');
    }
  },

  // --- Show Quick Command Tags ---
  async getShowQuickCommandTags(): Promise<boolean> {
    logger.debug(`[Service] Attempting to get setting for key: ${SHOW_QUICK_COMMAND_TAGS_KEY}`);
    try {
      const valueStr = await settingsRepository.getSetting(SHOW_QUICK_COMMAND_TAGS_KEY);
      logger.debug(
        `[Service] Raw value from repository for ${SHOW_QUICK_COMMAND_TAGS_KEY}:`,
        valueStr,
      );
      // 默认显示，所以只有当值为 'false' 时才返回 false
      return valueStr !== 'false';
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting show quick command tags setting (key: ${SHOW_QUICK_COMMAND_TAGS_KEY}):`,
        error,
      );
      return true;
    }
  },

  async setShowQuickCommandTags(enabled: boolean): Promise<void> {
    logger.debug(`[Service] setShowQuickCommandTags called with: ${enabled}`);
    try {
      const valueStr = String(enabled);
      logger.debug(
        `[Service] Attempting to save setting. Key: ${SHOW_QUICK_COMMAND_TAGS_KEY}, Value: ${valueStr}`,
      );
      await settingsRepository.setSetting(SHOW_QUICK_COMMAND_TAGS_KEY, valueStr);
      logger.debug(`[Service] Successfully saved setting for key: ${SHOW_QUICK_COMMAND_TAGS_KEY}`);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${SHOW_QUICK_COMMAND_TAGS_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存快捷指令标签显示设置失败');
    }
  },

  // --- Show Status Monitor IP Address ---
  async getShowStatusMonitorIpAddress(): Promise<boolean> {
    logger.debug(
      `[Service] Attempting to get setting for key: ${SHOW_STATUS_MONITOR_IP_ADDRESS_KEY}`,
    );
    try {
      const valueStr = await settingsRepository.getSetting(SHOW_STATUS_MONITOR_IP_ADDRESS_KEY);
      // 默认显示 (true)，所以只有当值为 'false' 时才返回 false
      return valueStr !== 'false';
    } catch (error: unknown) {
      logger.error(
        `[Service] Error getting show status monitor IP address setting (key: ${SHOW_STATUS_MONITOR_IP_ADDRESS_KEY}):`,
        error,
      );
      return true;
    }
  },

  async setShowStatusMonitorIpAddress(enabled: boolean): Promise<void> {
    try {
      const valueStr = String(enabled);
      await settingsRepository.setSetting(SHOW_STATUS_MONITOR_IP_ADDRESS_KEY, valueStr);
    } catch (error: unknown) {
      logger.error(
        `[Service] Error calling settingsRepository.setSetting for key ${SHOW_STATUS_MONITOR_IP_ADDRESS_KEY}:`,
        error,
      );
      throw ErrorFactory.databaseError('保存状态监控 IP 地址显示设置失败');
    }
  },

  // --- 容器日志等级设置 ---
  /**
   * 获取容器日志等级
   * @returns 返回日志等级字符串，默认 'info'
   */
  async getLogLevel(): Promise<string> {
    try {
      const level = await settingsRepository.getSetting(LOG_LEVEL_KEY);
      const validLevels = ['debug', 'info', 'warn', 'error', 'silent'];
      if (level && validLevels.includes(level)) {
        return level;
      }
      return 'info';
    } catch (error: unknown) {
      logger.error(`[Service] Error getting log level setting:`, error);
      return 'info';
    }
  },

  /**
   * 设置容器日志等级
   * @param level 日志等级 ('debug' | 'info' | 'warn' | 'error' | 'silent')
   */
  async setLogLevel(level: string): Promise<void> {
    const validLevels = ['debug', 'info', 'warn', 'error', 'silent'];
    if (!validLevels.includes(level)) {
      throw ErrorFactory.badRequest(
        `无效的日志级别: ${level}，必须是以下之一: ${validLevels.join(', ')}`,
      );
    }
    try {
      await settingsRepository.setSetting(LOG_LEVEL_KEY, level);
    } catch (error: unknown) {
      logger.error(`[Service] Error setting log level:`, error);
      throw ErrorFactory.databaseError('保存日志级别设置失败');
    }
  },

  // --- 审计日志最大保留条数设置 ---
  /**
   * 获取审计日志最大保留条数
   * @returns 返回最大条数，默认 DEFAULT_AUDIT_LOG_MAX_ENTRIES
   */
  async getAuditLogMaxEntries(): Promise<number> {
    try {
      const maxStr = await settingsRepository.getSetting(AUDIT_LOG_MAX_ENTRIES_KEY);
      if (maxStr) {
        const maxNum = parseInt(maxStr, 10);
        if (!Number.isNaN(maxNum) && maxNum > 0) {
          return maxNum;
        }
      }
      return DEFAULT_AUDIT_LOG_MAX_ENTRIES;
    } catch (error: unknown) {
      logger.error(`[Service] Error getting audit log max entries:`, error);
      return DEFAULT_AUDIT_LOG_MAX_ENTRIES;
    }
  },

  /**
   * 设置审计日志最大保留条数
   * @param maxEntries 最大条数 (正整数)
   */
  async setAuditLogMaxEntries(maxEntries: number): Promise<void> {
    if (!Number.isInteger(maxEntries) || maxEntries <= 0) {
      throw ErrorFactory.badRequest('无效的最大条目值，必须为正整数。');
    }
    try {
      await settingsRepository.setSetting(AUDIT_LOG_MAX_ENTRIES_KEY, String(maxEntries));
    } catch (error: unknown) {
      logger.error(`[Service] Error setting audit log max entries:`, error);
      throw ErrorFactory.databaseError('保存审计日志最大条目设置失败');
    }
  },
}; // <-- End of settingsService object definition
