import { Database } from 'sqlite3';
import * as schemaSql from './schema';
import * as appearanceRepository from '../appearance/appearance.repository';
import * as terminalThemeRepository from '../terminal-themes/terminal-theme.repository';
import * as settingsRepository from '../settings/settings.repository';
import { presetTerminalThemes } from '../config/preset-themes-definition';
import { runDb } from './connection';

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
const initAuditLogsTable = async (db: Database): Promise<void> => {
    // 创建审计日志索引以优化查询性能
    for (const indexSql of schemaSql.createAuditLogsIndexesSQL) {
        await runDb(db, indexSql);
    }
    console.log('[DB Init] 审计日志索引创建完成。');
};

/**
 * 初始化批量任务表索引
 */
const initBatchTasksTable = async (db: Database): Promise<void> => {
    for (const indexSql of schemaSql.createBatchTasksIndexesSQL) {
        await runDb(db, indexSql);
    }
    console.log('[DB Init] 批量任务索引创建完成。');
};

/**
 * 初始化批量子任务表索引
 */
const initBatchSubTasksTable = async (db: Database): Promise<void> => {
    for (const indexSql of schemaSql.createBatchSubTasksIndexesSQL) {
        await runDb(db, indexSql);
    }
    console.log('[DB Init] 批量子任务索引创建完成。');
};

/**
 * 初始化 AI 会话表索引
 */
const initAISessionsTable = async (db: Database): Promise<void> => {
    for (const indexSql of schemaSql.createAISessionsIndexesSQL) {
        await runDb(db, indexSql);
    }
    console.log('[DB Init] AI会话索引创建完成。');
};

/**
 * 初始化 AI 消息表索引
 */
const initAIMessagesTable = async (db: Database): Promise<void> => {
    for (const indexSql of schemaSql.createAIMessagesIndexesSQL) {
        await runDb(db, indexSql);
    }
    console.log('[DB Init] AI消息索引创建完成。');
};

/**
 * 初始化文件传输策略表索引
 */
const initTransferPoliciesTable = async (db: Database): Promise<void> => {
    for (const indexSql of schemaSql.createTransferPoliciesIndexesSQL) {
        await runDb(db, indexSql);
    }
    console.log('[DB Init] 文件传输策略索引创建完成。');
};



/**
 * Initializes preset terminal themes.
 * Assumes terminalThemeRepository.initializePresetThemes might need the db instance.
 */
const initTerminalThemesTable = async (db: Database): Promise<void> => {
    // Pass the db instance to the repository function
    // Note: This might require modifying initializePresetThemes if it doesn't accept db
    await terminalThemeRepository.initializePresetThemes(db, presetTerminalThemes);
    console.log('[DB Init] 预设主题初始化检查完成。');
};

/**
 * Ensures default appearance settings exist.
 * Assumes appearanceRepository.ensureDefaultSettingsExist might need the db instance.
 */
const initAppearanceSettingsTable = async (db: Database): Promise<void> => {
    // Pass the db instance to the repository function
    // Note: This might require modifying ensureDefaultSettingsExist if it doesn't accept db
    await appearanceRepository.ensureDefaultSettingsExist(db);
    console.log('[DB Init] 外观设置初始化检查完成。');
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
        init: settingsRepository.ensureDefaultSettingsExist // <-- Use the function from the repository
    },
    {
        name: 'audit_logs',
        sql: schemaSql.createAuditLogsTableSQL,
        init: initAuditLogsTable // 添加索引初始化函数
    },
    // { name: 'api_keys', sql: schemaSql.createApiKeysTableSQL }, // Removed API Keys table from registry
    // { name: 'passkeys', sql: schemaSql.createPasskeysTableSQL }, // Removed Passkeys table from registry
    { name: 'notification_settings', sql: schemaSql.createNotificationSettingsTableSQL },
    { name: 'users', sql: schemaSql.createUsersTableSQL },

    // Features like proxies, connections, tags
    { name: 'proxies', sql: schemaSql.createProxiesTableSQL },
    { name: 'ssh_keys', sql: schemaSql.createSshKeysTableSQL }, // Added SSH Keys table
    { name: 'connections', sql: schemaSql.createConnectionsTableSQL }, // Depends on proxies, ssh_keys
    { name: 'tags', sql: schemaSql.createTagsTableSQL },
    { name: 'connection_tags', sql: schemaSql.createConnectionTagsTableSQL }, // Depends on connections, tags

    // Other utilities
    { name: 'ip_blacklist', sql: schemaSql.createIpBlacklistTableSQL },
    { name: 'command_history', sql: schemaSql.createCommandHistoryTableSQL },
    { name: 'path_history', sql: schemaSql.createPathHistoryTableSQL },
    { name: 'quick_commands', sql: schemaSql.createQuickCommandsTableSQL },
    { name: 'favorite_paths', sql: schemaSql.createFavoritePathsTableSQL }, // Added Favorite Paths table

    // Appearance related tables (often depend on others or have init logic)
    {
        name: 'terminal_themes',
        sql: schemaSql.createTerminalThemesTableSQL,
        init: initTerminalThemesTable
    },
    {
        name: 'appearance_settings',
        sql: schemaSql.createAppearanceSettingsTableSQL,
        init: initAppearanceSettingsTable
     }, // Depends on terminal_themes

    // 批量作业模块
    { name: 'quick_command_tags', sql: schemaSql.createQuickCommandTagsTableSQL },
    { name: 'quick_command_tag_associations', sql: schemaSql.createQuickCommandTagAssociationsTableSQL },
    {
        name: 'batch_tasks',
        sql: schemaSql.createBatchTasksTableSQL,
        init: initBatchTasksTable
    },
    {
        name: 'batch_subtasks',
        sql: schemaSql.createBatchSubTasksTableSQL,
        init: initBatchSubTasksTable
    },

    // AI 智能运维模块
    {
        name: 'ai_sessions',
        sql: schemaSql.createAISessionsTableSQL,
        init: initAISessionsTable
    },
    {
        name: 'ai_messages',
        sql: schemaSql.createAIMessagesTableSQL,
        init: initAIMessagesTable
    },

    // 文件传输策略模块
    {
        name: 'transfer_policies',
        sql: schemaSql.createTransferPoliciesTableSQL,
        init: initTransferPoliciesTable
    },
];