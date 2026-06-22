import { Database } from 'sqlite3';
import * as schemaSql from './schema';
import { presetTerminalThemes } from '../config/preset-themes-definition';
import { logger } from '../utils/logger';

interface RunResult {
  lastID: number;
  changes: number;
}

const runDb = (db: Database, sql: string, params: unknown[] = []): Promise<RunResult> => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function runDbCallback(this: RunResult, err: Error | null) {
      if (err) {
        logger.error(
          `[数据库错误] SQL: ${sql.substring(0, 100)}... 参数: ${JSON.stringify(params)} 错误: ${err.message}`,
        );
        reject(err);
      } else {
        resolve({ lastID: this.lastID, changes: this.changes });
      }
    });
  });
};

/**
 * Interface describing a database table definition for initialization.
 */
export interface TableDefinition {
  name: string;
  sql: string;
  init?: (db: Database) => Promise<void>;
}

/**
 * 初始化审计日志表索引
 * 为 audit_logs 表创建性能优化索引
 */
const initAuditLogsTable = async (_db: Database): Promise<void> => {
  // 索引创建已移至 migrations.ts（迁移 #12），避免在旧数据库上因 user_id 列尚未添加而失败
  logger.debug('[DB Init] 审计日志表初始化检查完成（索引由迁移管理）。');
};

/**
 * 初始化连接表索引
 */
const initConnectionsTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createConnectionsIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] 连接表索引创建完成。');
};

/**
 * 初始化命令历史表索引
 */
const initCommandHistoryTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createCommandHistoryIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] 命令历史索引创建完成。');
};

/**
 * 初始化路径历史表索引
 */
const initPathHistoryTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createPathHistoryIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] 路径历史索引创建完成。');
};

/**
 * 初始化批量任务表索引
 */
const initBatchTasksTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createBatchTasksIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] 批量任务索引创建完成。');
};

/**
 * 初始化批量子任务表索引
 */
const initBatchSubTasksTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createBatchSubTasksIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] 批量子任务索引创建完成。');
};

/**
 * 初始化 AI 会话表索引
 */
const initAISessionsTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createAISessionsIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] AI会话索引创建完成。');
};

/**
 * 初始化 AI 消息表索引
 */
const initAIMessagesTable = async (db: Database): Promise<void> => {
  for (const indexSql of schemaSql.createAIMessagesIndexesSQL) {
    await runDb(db, indexSql);
  }
  logger.debug('[DB Init] AI消息索引创建完成。');
};

/**
 * Initializes preset terminal themes.
 * Assumes terminalThemeRepository.initializePresetThemes might need the db instance.
 */
const initTerminalThemesTable = async (db: Database): Promise<void> => {
  const { initializePresetThemes } =
    await import('../terminal-themes/terminal-theme.repository.js');
  await initializePresetThemes(db, presetTerminalThemes);
  logger.debug('[DB Init] 预设主题初始化检查完成。');
};

/**
 * Ensures default appearance settings exist.
 * Assumes appearanceRepository.ensureDefaultSettingsExist might need the db instance.
 */
const initAppearanceSettingsTable = async (db: Database): Promise<void> => {
  const { ensureDefaultSettingsExist } = await import('../appearance/appearance.repository.js');
  await ensureDefaultSettingsExist(db);
  logger.debug('[DB Init] 外观设置初始化检查完成。');
};

// --- Table Definitions Registry ---

/**
 * Array containing definitions for all tables to be created and initialized.
 * The order might matter if there are strict foreign key dependencies without ON DELETE/UPDATE clauses,
 * but CREATE IF NOT EXISTS makes it generally safe. Initialization order might also matter.
 */
export const tableDefinitions: TableDefinition[] = [
  // Core settings and logs first
  {
    name: 'settings',
    sql: schemaSql.createSettingsTableSQL,
    init: async (db) => {
      const { ensureDefaultSettingsExist } = await import('../settings/settings.repository.js');
      await ensureDefaultSettingsExist(db);
    },
  },
  {
    name: 'audit_logs',
    sql: schemaSql.createAuditLogsTableSQL,
    init: initAuditLogsTable, // 添加索引初始化函数
  },
  // { name: 'api_keys', sql: schemaSql.createApiKeysTableSQL }, // Removed API Keys table from registry
  // { name: 'passkeys', sql: schemaSql.createPasskeysTableSQL }, // Removed Passkeys table from registry
  { name: 'notification_settings', sql: schemaSql.createNotificationSettingsTableSQL },
  { name: 'users', sql: schemaSql.createUsersTableSQL },

  // Features like proxies, connections, tags
  { name: 'proxies', sql: schemaSql.createProxiesTableSQL },
  { name: 'ssh_keys', sql: schemaSql.createSshKeysTableSQL }, // Added SSH Keys table
  { name: 'connections', sql: schemaSql.createConnectionsTableSQL, init: initConnectionsTable }, // Depends on proxies, ssh_keys
  { name: 'tags', sql: schemaSql.createTagsTableSQL },
  { name: 'connection_tags', sql: schemaSql.createConnectionTagsTableSQL }, // Depends on connections, tags

  // Other utilities
  { name: 'ip_blacklist', sql: schemaSql.createIpBlacklistTableSQL },
  {
    name: 'command_history',
    sql: schemaSql.createCommandHistoryTableSQL,
    init: initCommandHistoryTable,
  },
  { name: 'path_history', sql: schemaSql.createPathHistoryTableSQL, init: initPathHistoryTable },
  { name: 'quick_commands', sql: schemaSql.createQuickCommandsTableSQL },
  { name: 'favorite_paths', sql: schemaSql.createFavoritePathsTableSQL }, // Added Favorite Paths table

  // Appearance related tables (often depend on others or have init logic)
  {
    name: 'terminal_themes',
    sql: schemaSql.createTerminalThemesTableSQL,
    init: initTerminalThemesTable,
  },
  {
    name: 'appearance_settings',
    sql: schemaSql.createAppearanceSettingsTableSQL,
    init: initAppearanceSettingsTable,
  }, // Depends on terminal_themes

  // 批量作业模块
  { name: 'quick_command_tags', sql: schemaSql.createQuickCommandTagsTableSQL },
  {
    name: 'quick_command_tag_associations',
    sql: schemaSql.createQuickCommandTagAssociationsTableSQL,
  },
  {
    name: 'batch_tasks',
    sql: schemaSql.createBatchTasksTableSQL,
    init: initBatchTasksTable,
  },
  {
    name: 'batch_subtasks',
    sql: schemaSql.createBatchSubTasksTableSQL,
    init: initBatchSubTasksTable,
  },

  // AI 智能运维模块
  {
    name: 'ai_sessions',
    sql: schemaSql.createAISessionsTableSQL,
    init: initAISessionsTable,
  },
  {
    name: 'ai_messages',
    sql: schemaSql.createAIMessagesTableSQL,
    init: initAIMessagesTable,
  },

  // IP 地理定位缓存
  {
    name: 'ip_geo_cache',
    sql: schemaSql.createIpGeoCacheTableSQL,
    init: async (db: Database) => {
      for (const indexSql of schemaSql.createIpGeoCacheIndexesSQL) {
        await runDb(db, indexSql);
      }
      logger.debug('[DB Init] IP 地理定位缓存索引创建完成。');
    },
  },

  // 事件日志表
  {
    name: 'event_logs',
    sql: schemaSql.createEventLogsTableSQL,
    init: async (db: Database) => {
      for (const indexSql of schemaSql.createEventLogsIndexesSQL) {
        await runDb(db, indexSql);
      }
      logger.debug('[DB Init] 事件日志表索引创建完成。');
    },
  },

  // AI 审计模块
  {
    name: 'audit_reports',
    sql: schemaSql.createAuditReportsTableSQL,
    init: async (db: Database) => {
      for (const indexSql of schemaSql.createAuditReportsIndexesSQL) {
        await runDb(db, indexSql);
      }
      logger.debug('[DB Init] 审计报告表索引创建完成。');
    },
  },
  {
    name: 'audit_anomalies',
    sql: schemaSql.createAuditAnomaliesTableSQL,
    init: async (db: Database) => {
      for (const indexSql of schemaSql.createAuditAnomaliesIndexesSQL) {
        await runDb(db, indexSql);
      }
      logger.debug('[DB Init] 异常检测表索引创建完成。');
    },
  },
  {
    name: 'ai_audit_tasks',
    sql: schemaSql.createAiAuditTasksTableSQL,
    init: async (db: Database) => {
      for (const indexSql of schemaSql.createAiAuditTasksIndexesSQL) {
        await runDb(db, indexSql);
      }
      logger.debug('[DB Init] AI 审计任务表索引创建完成。');
    },
  },
];
