import * as sqlite3 from 'sqlite3';
import { ErrorFactory, getErrorMessage } from '../utils/AppError';
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { SidebarConfig, LayoutNode, CaptchaSettings } from '../types/settings.types';
import { logger } from '../utils/logger';
import { cacheService } from '../services/cache.service';

// 登录封禁默认时长（秒），对应 5 分钟
const DEFAULT_LOGIN_BAN_DURATION_SECONDS = 300;

const SIDEBAR_CONFIG_KEY = 'sidebarConfig';
const CAPTCHA_CONFIG_KEY = 'captchaConfig';

// 缓存配置
const SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 分钟
const SETTINGS_CACHE_PREFIX = 'setting:';

export interface Setting {
  key: string;
  value: string;
}

type DbSettingRow = Setting;

export const settingsRepository = {
  async getAllSettings(): Promise<Setting[]> {
    try {
      const db = await getDbInstance();
      const rows = await allDb<DbSettingRow>(db, 'SELECT key, value FROM settings');
      return rows;
    } catch (err: unknown) {
      logger.error('[Repository] 获取所有设置时出错:', getErrorMessage(err));
      throw ErrorFactory.databaseError('获取设置失败', '获取设置失败');
    }
  },

  async getSetting(key: string): Promise<string | null> {
    // 1. 先查缓存
    const cached = cacheService.get<string>(`${SETTINGS_CACHE_PREFIX}${key}`);
    if (cached !== null) {
      return cached;
    }

    // 2. 查数据库
    try {
      const db = await getDbInstance();
      const row = await getDbRow<{ value: string }>(
        db,
        'SELECT value FROM settings WHERE key = ?',
        [key],
      );
      const value = row ? row.value : null;

      // 3. 写入缓存（仅缓存非空值）
      if (value !== null) {
        cacheService.set(`${SETTINGS_CACHE_PREFIX}${key}`, value, SETTINGS_CACHE_TTL);
      }

      return value;
    } catch (err: unknown) {
      logger.error(`[Repository] 获取设置项 ${key} 时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '获取设置项失败',
        `获取设置项 ${key} 失败: ${getErrorMessage(err)}`,
      );
    }
  },

  async setSetting(key: string, value: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const sql = `INSERT INTO settings (key, value, created_at, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
           value = excluded.value,
           updated_at = excluded.updated_at`;
    const params = [key, value, now, now];

    try {
      const db = await getDbInstance();
      await runDb(db, sql, params);
      // 写入成功后失效缓存
      cacheService.delete(`${SETTINGS_CACHE_PREFIX}${key}`);
    } catch (err: unknown) {
      logger.error(`[Repository] 设置设置项 ${key} 时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '设置设置项失败',
        `设置设置项 ${key} 失败: ${getErrorMessage(err)}`,
      );
    }
  },

  async deleteSetting(key: string): Promise<boolean> {
    const sql = 'DELETE FROM settings WHERE key = ?';
    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, [key]);
      // 删除成功后失效缓存
      if (result.changes > 0) {
        cacheService.delete(`${SETTINGS_CACHE_PREFIX}${key}`);
      }
      return result.changes > 0;
    } catch (err: unknown) {
      logger.error(`[Repository] 删除设置项 ${key} 时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '删除设置项失败',
        `删除设置项 ${key} 失败: ${getErrorMessage(err)}`,
      );
    }
  },

  async setMultipleSettings(settings: Record<string, string>): Promise<void> {
    // logger.info('[仓库] 调用 setMultipleSettings，参数:', JSON.stringify(settings));
    const promises = Object.entries(settings).map(([key, value]) => this.setSetting(key, value));
    try {
      await Promise.all(promises);
      // logger.info('[仓库] setMultipleSettings 成功完成。');
    } catch (error: unknown) {
      logger.error('[仓库] setMultipleSettings 失败:', error);
      throw ErrorFactory.databaseError('批量设置失败', '批量设置失败');
    }
  },
};

/**
 * 获取侧栏配置
 */
export const getSidebarConfig = async (): Promise<SidebarConfig> => {
  const defaultValue: SidebarConfig = { left: [], right: [] };
  try {
    const jsonString = await settingsRepository.getSetting(SIDEBAR_CONFIG_KEY);
    if (jsonString) {
      try {
        const config = JSON.parse(jsonString);
        if (config && Array.isArray(config.left) && Array.isArray(config.right)) {
          return config as SidebarConfig;
        }
        logger.warn('[设置仓库] 在数据库中发现无效的 sidebarConfig 格式。返回默认值。');
      } catch (parseError: unknown) {
        logger.error('[设置仓库] 从数据库解析 sidebarConfig JSON 失败。', parseError);
      }
    }
  } catch (error: unknown) {
    logger.error(`[设置仓库] 获取侧边栏配置设置时出错 (键: ${SIDEBAR_CONFIG_KEY}):`, error);
  }
  return defaultValue;
};

/**
 * 设置侧栏配置
 */
export const setSidebarConfig = async (config: SidebarConfig): Promise<void> => {
  try {
    if (
      !config ||
      typeof config !== 'object' ||
      !Array.isArray(config.left) ||
      !Array.isArray(config.right)
    ) {
      throw ErrorFactory.databaseError(
        '提供了无效的侧边栏配置对象。',
        '提供了无效的侧边栏配置对象。',
      );
    }
    const jsonString = JSON.stringify(config);
    await settingsRepository.setSetting(SIDEBAR_CONFIG_KEY, jsonString);
  } catch (error: unknown) {
    logger.error(`[设置仓库] 设置侧边栏配置时出错 (键: ${SIDEBAR_CONFIG_KEY}):`, error);
    throw ErrorFactory.databaseError('保存侧边栏配置失败。', '保存侧边栏配置失败。');
  }
};

/**
 * 获取 CAPTCHA 配置
 * @returns Promise<CaptchaSettings> - 返回解析后的配置或默认值
 */
export const getCaptchaConfig = async (): Promise<CaptchaSettings> => {
  const defaultValue: CaptchaSettings = {
    enabled: false,
    provider: 'none',
    hcaptchaSiteKey: '',
    hcaptchaSecretKey: '',
    recaptchaSiteKey: '',
    recaptchaSecretKey: '',
  };
  try {
    const jsonString = await settingsRepository.getSetting(CAPTCHA_CONFIG_KEY);
    if (jsonString) {
      try {
        const config = JSON.parse(jsonString);
        if (config && typeof config.enabled === 'boolean' && typeof config.provider === 'string') {
          return {
            enabled: config.enabled ?? defaultValue.enabled,
            provider: config.provider ?? defaultValue.provider,
            hcaptchaSiteKey: config.hcaptchaSiteKey ?? defaultValue.hcaptchaSiteKey,
            hcaptchaSecretKey: config.hcaptchaSecretKey ?? defaultValue.hcaptchaSecretKey,
            recaptchaSiteKey: config.recaptchaSiteKey ?? defaultValue.recaptchaSiteKey,
            recaptchaSecretKey: config.recaptchaSecretKey ?? defaultValue.recaptchaSecretKey,
          } as CaptchaSettings;
        }
        logger.warn('[设置仓库] 在数据库中发现无效的 captchaConfig 格式。返回默认值。');
      } catch (parseError: unknown) {
        logger.error('[设置仓库] 从数据库解析 captchaConfig JSON 失败。', parseError);
      }
    }
  } catch (error: unknown) {
    logger.error(`[设置仓库] 获取 CAPTCHA 配置设置时出错 (键: ${CAPTCHA_CONFIG_KEY}):`, error);
  }
  return defaultValue;
};

/**
 * 设置 CAPTCHA 配置
 */
export const setCaptchaConfig = async (config: CaptchaSettings): Promise<void> => {
  try {
    if (
      !config ||
      typeof config !== 'object' ||
      typeof config.enabled !== 'boolean' ||
      typeof config.provider !== 'string'
    ) {
      throw ErrorFactory.databaseError(
        '提供了无效的 CAPTCHA 配置对象。',
        '提供了无效的 CAPTCHA 配置对象。',
      );
    }
    config.hcaptchaSecretKey = config.hcaptchaSecretKey || '';
    config.recaptchaSecretKey = config.recaptchaSecretKey || '';
    config.hcaptchaSiteKey = config.hcaptchaSiteKey || '';
    config.recaptchaSiteKey = config.recaptchaSiteKey || '';

    const jsonString = JSON.stringify(config);
    await settingsRepository.setSetting(CAPTCHA_CONFIG_KEY, jsonString);
  } catch (error: unknown) {
    logger.error(`[设置仓库] 设置 CAPTCHA 配置时出错 (键: ${CAPTCHA_CONFIG_KEY}):`, error);
    throw ErrorFactory.databaseError('保存 CAPTCHA 配置失败。', '保存 CAPTCHA 配置失败。');
  }
};

/**
 * 确保设置表中存在默认设置。
 * 此函数应在数据库初始化期间调用。
 */
export const ensureDefaultSettingsExist = async (db: sqlite3.Database): Promise<void> => {
  type OmitIdRecursive<T> = T extends object
    ? { [K in keyof Omit<T, 'id'>]: OmitIdRecursive<T[K]> }
    : T;

  const defaultLayoutTreeStructure: OmitIdRecursive<LayoutNode> = {
    type: 'container',
    direction: 'horizontal',
    children: [
      {
        type: 'container',
        direction: 'vertical',
        children: [
          { type: 'pane', component: 'statusMonitor', size: 44.56 },
          { type: 'pane', component: 'commandHistory', size: 26.24 },
          { type: 'pane', component: 'quickCommands', size: 29.2 },
        ],
        size: 14.59,
      },
      {
        type: 'container',
        direction: 'vertical',
        size: 58.03,
        children: [
          { type: 'pane', component: 'terminal', size: 59.95 },
          { type: 'pane', component: 'commandBar', size: 5 },
          { type: 'pane', component: 'fileManager', size: 35.05 },
        ],
      },
      {
        type: 'container',
        direction: 'vertical',
        size: 27.38,
        children: [{ type: 'pane', component: 'editor', size: 100 }],
      },
    ],
  };

  const defaultSidebarPanesStructure: SidebarConfig = {
    left: ['connections', 'dockerManager'],
    right: [],
  };

  const defaultCaptchaSettings: CaptchaSettings = {
    enabled: false,
    provider: 'none',
    hcaptchaSiteKey: '',
    hcaptchaSecretKey: '',
    recaptchaSiteKey: '',
    recaptchaSecretKey: '',
  };

  const defaultSettings: Record<string, string> = {
    ipWhitelistEnabled: 'false',
    ipWhitelist: '',
    maxLoginAttempts: '5',
    loginBanDuration: String(DEFAULT_LOGIN_BAN_DURATION_SECONDS),
    focusSwitcherSequence: JSON.stringify([
      'quickCommandsSearch',
      'commandHistorySearch',
      'fileManagerSearch',
      'commandInput',
      'terminalSearch',
    ]),
    navBarVisible: 'true',
    layoutTree: JSON.stringify(defaultLayoutTreeStructure),
    autoCopyOnSelect: 'false',
    showPopupFileEditor: 'false',
    shareFileEditorTabs: 'true',
    dockerStatusIntervalSeconds: '5',
    dockerDefaultExpand: 'false',
    statusMonitorIntervalSeconds: '3',
    [SIDEBAR_CONFIG_KEY]: JSON.stringify(defaultSidebarPanesStructure),
    [CAPTCHA_CONFIG_KEY]: JSON.stringify(defaultCaptchaSettings),
    timezone: 'UTC', // 时区默认值
    terminalScrollbackLimit: '5000', // 终端回滚行数默认值
    terminalAutoWrapEnabled: 'true', // 终端自动换行默认启用
    sshSuspendKeepAliveSeconds: '0', // 挂起会话保活时长（秒），0 表示永久
    terminalEnableRightClickPaste: 'true', // 终端右键粘贴默认值
    terminalRenderMode: 'auto', // 终端渲染模式（auto/webgl/canvas/dom）
    terminalShowFps: 'false', // 是否显示 FPS（字符串布尔值）
  };
  const nowSeconds = Math.floor(Date.now() / 1000);
  const sqlInsertOrIgnore = `INSERT OR IGNORE INTO settings (key, value, created_at, updated_at) VALUES (?, ?, ?, ?)`;

  try {
    for (const [key, value] of Object.entries(defaultSettings)) {
      await runDb(db, sqlInsertOrIgnore, [key, value, nowSeconds, nowSeconds]);
    }
  } catch (err: unknown) {
    logger.error(`[设置仓库] 确保默认设置时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError(
      '确保默认设置失败',
      `确保默认设置失败: ${getErrorMessage(err)}`,
    );
  }
};
