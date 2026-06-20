import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { ErrorFactory, getErrorMessage } from '../utils/AppError';
import {
  NotificationSetting,
  RawNotificationSetting,
  NotificationEvent,
  NotificationChannelConfig,
} from '../types/notification.types';
import { logger } from '../utils/logger';

const parseRawSetting = (raw: RawNotificationSetting): NotificationSetting => {
  try {
    return {
      ...raw,
      enabled: Boolean(raw.enabled),
      config: JSON.parse(raw.config || '{}'),
      enabled_events: JSON.parse(raw.enabled_events || '[]'),
    };
  } catch (error: unknown) {
    logger.error(`解析通知设置 ID ${raw.id} 时出错:`, getErrorMessage(error));
    return {
      ...raw,
      enabled: Boolean(raw.enabled),
      config: {} as NotificationChannelConfig,
      enabled_events: [],
    };
  }
};

export class NotificationSettingsRepository {
  async getAll(): Promise<NotificationSetting[]> {
    try {
      const db = await getDbInstance();
      const rows = await allDb<RawNotificationSetting>(
        db,
        'SELECT * FROM notification_settings ORDER BY created_at ASC',
      );
      return rows.map(parseRawSetting);
    } catch (err: unknown) {
      logger.error(`获取通知设置时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '获取通知设置失败',
        `获取通知设置时出错: ${getErrorMessage(err)}`,
      );
    }
  }

  async getById(id: number): Promise<NotificationSetting | null> {
    try {
      const db = await getDbInstance();
      const row = await getDbRow<RawNotificationSetting>(
        db,
        'SELECT * FROM notification_settings WHERE id = ?',
        [id],
      );
      return row ? parseRawSetting(row) : null;
    } catch (err: unknown) {
      logger.error(`通过 ID ${id} 获取通知设置时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '获取通知设置失败',
        `通过 ID ${id} 获取通知设置时出错: ${getErrorMessage(err)}`,
      );
    }
  }

  // 事件配置缓存：static 共享，确保所有实例（Controller/Service/Processor）使用同一份缓存
  private static enabledByEventCache = new Map<
    string,
    { data: NotificationSetting[]; ts: number }
  >();
  private static readonly CACHE_TTL_MS = 30_000;

  private invalidateCache(): void {
    NotificationSettingsRepository.enabledByEventCache.clear();
  }

  async getEnabledByEvent(event: NotificationEvent): Promise<NotificationSetting[]> {
    const now = Date.now();
    const cached = NotificationSettingsRepository.enabledByEventCache.get(event);
    if (cached && now - cached.ts < NotificationSettingsRepository.CACHE_TTL_MS) {
      return cached.data;
    }
    try {
      const db = await getDbInstance();
      const rows = await allDb<RawNotificationSetting>(
        db,
        'SELECT * FROM notification_settings WHERE enabled = 1',
      );
      const parsedRows = rows.map(parseRawSetting);
      const filteredRows = parsedRows.filter((setting) => setting.enabled_events.includes(event));
      NotificationSettingsRepository.enabledByEventCache.set(event, {
        data: filteredRows,
        ts: now,
      });
      return filteredRows;
    } catch (err: unknown) {
      logger.error(`获取启用的通知设置时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '获取通知设置失败',
        `获取启用的通知设置时出错: ${getErrorMessage(err)}`,
      );
    }
  }

  async create(
    setting: Omit<NotificationSetting, 'id' | 'created_at' | 'updated_at'>,
  ): Promise<number> {
    const sql = `
            INSERT INTO notification_settings (channel_type, name, enabled, config, enabled_events, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
        `;
    const params = [
      setting.channel_type,
      setting.name ?? '',
      setting.enabled ? 1 : 0,
      JSON.stringify(setting.config || {}),
      JSON.stringify(setting.enabled_events || []),
    ];
    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, params);
      // runDb 成功后立即清缓存（即使 lastID 校验失败，数据已落库）
      this.invalidateCache();
      // Ensure lastID is valid before returning
      if (typeof result.lastID !== 'number' || result.lastID <= 0) {
        throw ErrorFactory.databaseError(
          '创建通知设置后未能获取有效的 lastID',
          '创建通知设置后未能获取有效的 lastID',
        );
      }
      return result.lastID;
    } catch (err: unknown) {
      logger.error(`创建通知设置时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '创建通知设置失败',
        `创建通知设置时出错: ${getErrorMessage(err)}`,
      );
    }
  }

  async update(
    id: number,
    setting: Partial<Omit<NotificationSetting, 'id' | 'created_at' | 'updated_at'>>,
  ): Promise<boolean> {
    const fields: string[] = [];
    const params: (string | number | null)[] = [];

    if (setting.channel_type !== undefined) {
      fields.push('channel_type = ?');
      params.push(setting.channel_type);
    }
    if (setting.name !== undefined) {
      fields.push('name = ?');
      params.push(setting.name);
    }
    if (setting.enabled !== undefined) {
      fields.push('enabled = ?');
      params.push(setting.enabled ? 1 : 0);
    }
    if (setting.config !== undefined) {
      fields.push('config = ?');
      params.push(JSON.stringify(setting.config || {}));
    }
    if (setting.enabled_events !== undefined) {
      fields.push('enabled_events = ?');
      params.push(JSON.stringify(setting.enabled_events || []));
    }

    if (fields.length === 0) {
      logger.warn(`[通知仓库] 针对 ID ${id} 调用了更新，但没有要更新的字段。`);
      return true;
    }

    fields.push("updated_at = strftime('%s', 'now')");

    const sql = `UPDATE notification_settings SET ${fields.join(', ')} WHERE id = ?`;
    params.push(id);

    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, params);
      if (result.changes > 0) this.invalidateCache();
      return result.changes > 0;
    } catch (err: unknown) {
      logger.error(`更新通知设置 ID ${id} 时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '更新通知设置失败',
        `更新通知设置 ID ${id} 时出错: ${getErrorMessage(err)}`,
      );
    }
  }

  async delete(id: number): Promise<boolean> {
    const sql = 'DELETE FROM notification_settings WHERE id = ?';
    try {
      const db = await getDbInstance();
      const result = await runDb(db, sql, [id]);
      if (result.changes > 0) this.invalidateCache();
      return result.changes > 0;
    } catch (err: unknown) {
      logger.error(`删除通知设置 ID ${id} 时出错:`, getErrorMessage(err));
      throw ErrorFactory.databaseError(
        '删除通知设置失败',
        `删除通知设置 ID ${id} 时出错: ${getErrorMessage(err)}`,
      );
    }
  }
}
