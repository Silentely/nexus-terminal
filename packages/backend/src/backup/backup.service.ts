/**
 * 数据备份服务
 * 提供导出/导入核心业务数据的能力
 *
 * 以下表不纳入备份范围（原因如下）：
 * - audit_logs：审计日志属于运营数据，体积大且无迁移价值
 * - command_history / path_history：命令与路径历史为临时性数据
 * - ip_blacklist / ip_geo_cache：IP 封禁与地理缓存为环境相关数据，不跨实例迁移
 * - batch_tasks / batch_subtasks：批量任务为运行时状态，不可恢复
 * - ai_sessions / ai_messages：AI 会话为临时对话数据
 * - users：单用户模式下由初始设置流程创建，无需备份
 * - passkeys：Passkey 凭证绑定设备，无法跨实例迁移
 */

import { getDbInstance, allDb, runDb } from '../database/connection';
import eventService, { AppEventType } from '../services/event.service';
import {
  BACKUP_FORMAT_VERSION,
  type BackupMetadata,
  type BackupPayload,
  type ImportOptions,
  type ImportResult,
} from './backup.types';

/** 需要备份的表及其导出 SQL */
const EXPORT_TABLES: Record<keyof Omit<BackupPayload, 'metadata'>, string> = {
  connections: 'SELECT * FROM connections',
  sshKeys: 'SELECT * FROM ssh_keys',
  proxies: 'SELECT * FROM proxies',
  tags: 'SELECT * FROM tags',
  connectionTags: 'SELECT * FROM connection_tags',
  quickCommands: 'SELECT * FROM quick_commands',
  quickCommandTags: 'SELECT * FROM quick_command_tags',
  quickCommandTagAssociations: 'SELECT * FROM quick_command_tag_associations',
  terminalThemes: 'SELECT * FROM terminal_themes',
  notificationSettings: 'SELECT * FROM notification_settings',
  settings: "SELECT * FROM settings WHERE key NOT IN ('encryptionKeyVersion', 'encryptionKey')",
  appearanceSettings: 'SELECT * FROM appearance_settings',
  favoritePaths: 'SELECT * FROM favorite_paths',
};

/** 导入表的插入语句模板（INSERT OR IGNORE 防止重复） */
const IMPORT_TABLES: Record<
  keyof Omit<BackupPayload, 'metadata'>,
  { table: string; columns: string[] }
> = {
  connections: {
    table: 'connections',
    columns: [
      'name',
      'type',
      'host',
      'port',
      'username',
      'auth_method',
      'encrypted_password',
      'encrypted_private_key',
      'encrypted_passphrase',
      'proxy_id',
      'ssh_key_id',
      'notes',
      'jump_chain',
      'proxy_type',
      'force_keyboard_interactive',
    ],
  },
  sshKeys: {
    table: 'ssh_keys',
    columns: ['name', 'encrypted_private_key', 'encrypted_passphrase'],
  },
  proxies: {
    table: 'proxies',
    columns: [
      'name',
      'type',
      'host',
      'port',
      'username',
      'auth_method',
      'encrypted_password',
      'encrypted_private_key',
      'encrypted_passphrase',
    ],
  },
  tags: { table: 'tags', columns: ['name'] },
  connectionTags: { table: 'connection_tags', columns: ['connection_id', 'tag_id'] },
  quickCommands: {
    table: 'quick_commands',
    columns: ['name', 'command', 'usage_count', 'variables'],
  },
  quickCommandTags: { table: 'quick_command_tags', columns: ['name'] },
  quickCommandTagAssociations: {
    table: 'quick_command_tag_associations',
    columns: ['quick_command_id', 'tag_id'],
  },
  terminalThemes: {
    table: 'terminal_themes',
    columns: [
      'name',
      'theme_type',
      'foreground',
      'background',
      'cursor',
      'cursor_accent',
      'selection_background',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'bright_black',
      'bright_red',
      'bright_green',
      'bright_yellow',
      'bright_blue',
      'bright_magenta',
      'bright_cyan',
      'bright_white',
      'created_at',
      'updated_at',
    ],
  },
  notificationSettings: {
    table: 'notification_settings',
    columns: [
      'channel_type',
      'name',
      'enabled',
      'config',
      'enabled_events',
      'created_at',
      'updated_at',
    ],
  },
  settings: { table: 'settings', columns: ['key', 'value'] },
  appearanceSettings: { table: 'appearance_settings', columns: ['key', 'value'] },
  favoritePaths: {
    table: 'favorite_paths',
    columns: ['name', 'path', 'last_used_at', 'created_at', 'updated_at'],
  },
};

/** 导出所有核心业务数据 */
export async function exportData(): Promise<BackupPayload> {
  try {
    const db = await getDbInstance();
    const result: BackupPayload = {
      metadata: {
        version: BACKUP_FORMAT_VERSION,
        exportedAt: Date.now(),
        recordCounts: {},
      },
      connections: [],
      sshKeys: [],
      proxies: [],
      tags: [],
      connectionTags: [],
      quickCommands: [],
      quickCommandTags: [],
      quickCommandTagAssociations: [],
      terminalThemes: [],
      notificationSettings: [],
      settings: [],
      appearanceSettings: [],
      favoritePaths: [],
    };

    for (const [key, sql] of Object.entries(EXPORT_TABLES)) {
      const rows = await allDb<Record<string, unknown>>(db, sql);
      (result as unknown as Record<string, unknown>)[key] = rows;
      result.metadata.recordCounts[key] = rows.length;
    }

    eventService.emitEvent(AppEventType.BackupExportCompleted, {
      details: { timestamp: new Date().toISOString() },
    });

    return result;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    eventService.emitEvent(AppEventType.BackupExportFailed, {
      details: { reason: msg },
    });
    throw error;
  }
}

/** 从备份数据导入到数据库（事务性：失败时回滚） */
export async function importData(
  payload: BackupPayload,
  options: ImportOptions = {},
): Promise<ImportResult> {
  const db = await getDbInstance();
  const { overwrite = false, tables } = options;
  const result: ImportResult = { imported: {}, skipped: {}, errors: [] };

  const tablesToImport =
    tables || (Object.keys(IMPORT_TABLES) as (keyof Omit<BackupPayload, 'metadata'>)[]);

  // 使用事务确保导入原子性：任何失败自动回滚
  await runDb(db, 'BEGIN TRANSACTION');

  try {
    for (const key of tablesToImport) {
      const config = IMPORT_TABLES[key];
      if (!config) {
        result.errors.push(`未知的表: ${key}`);
        continue;
      }

      const rows = (payload as unknown as Record<string, unknown[]>)[key];
      if (!Array.isArray(rows) || rows.length === 0) {
        result.imported[key] = 0;
        result.skipped[key] = 0;
        continue;
      }

      // 向前兼容：旧版备份文件中 quick_commands 使用 content/description/is_active 字段
      const normalizedRows =
        key === 'quickCommands'
          ? rows.map((row) => {
              const r = Object.assign({}, row) as Record<string, unknown>;
              if (r.command == null && r.content != null) r.command = r.content;
              if (r.usage_count == null) r.usage_count = 0;
              if (r.variables == null && r.is_active != null) r.variables = null;
              return r;
            })
          : rows;

      let imported = 0;
      let skipped = 0;

      const placeholders = config.columns.map(() => '?').join(', ');
      const insertSql = overwrite
        ? `INSERT OR REPLACE INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`
        : `INSERT OR IGNORE INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`;

      for (const row of normalizedRows) {
        try {
          const values = config.columns.map((col) => (row as Record<string, unknown>)[col] ?? null);
          const { changes } = await runDb(db, insertSql, values);
          if (changes > 0) imported++;
          else skipped++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          // 仅忽略约束冲突类错误，其余向上抛出触发回滚
          if (msg.includes('UNIQUE') || msg.includes('constraint') || msg.includes('NOT NULL')) {
            result.errors.push(`${key} 导入失败: ${msg}`);
            skipped++;
          } else {
            throw err;
          }
        }
      }

      result.imported[key] = imported;
      result.skipped[key] = skipped;
    }

    // 有错误时回滚，否则提交
    if (result.errors.length > 0) {
      await runDb(db, 'ROLLBACK');
      // 回滚后数据未实际落库，清空统计避免误导调用方
      result.imported = {};
      result.skipped = {};
    } else {
      await runDb(db, 'COMMIT');
      eventService.emitEvent(AppEventType.BackupImportCompleted, {
        details: {
          imported: result.imported,
          skipped: result.skipped,
          errors: result.errors.length,
        },
      });
    }
  } catch (err: unknown) {
    await runDb(db, 'ROLLBACK').catch(() => {});
    const msg = err instanceof Error ? err.message : String(err);
    result.errors.push(`导入事务失败，已回滚: ${msg}`);
    eventService.emitEvent(AppEventType.BackupImportFailed, {
      details: { reason: msg },
    });
  }

  return result;
}

/** 获取备份文件的预览信息（不执行导入） */
export function validateBackup(payload: unknown): {
  valid: boolean;
  metadata?: BackupMetadata;
  error?: string;
} {
  if (!payload || typeof payload !== 'object') {
    return { valid: false, error: '无效的备份数据格式' };
  }

  const data = payload as Record<string, unknown>;
  if (!data.metadata || typeof data.metadata !== 'object') {
    return { valid: false, error: '缺少备份元信息' };
  }

  const meta = data.metadata as BackupMetadata;
  if (typeof meta.version !== 'number' || meta.version < 1) {
    return { valid: false, error: `不支持的备份版本: ${meta.version}` };
  }

  if (meta.version > BACKUP_FORMAT_VERSION) {
    return {
      valid: false,
      error: `备份版本 ${meta.version} 高于当前支持的版本 ${BACKUP_FORMAT_VERSION}`,
    };
  }

  return { valid: true, metadata: meta };
}
