import { Database } from 'sqlite3';
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';

// 1. 定义 migrations 表 SQL
const createMigrationsTableSQL = `
CREATE TABLE IF NOT EXISTS migrations (
    id INTEGER PRIMARY KEY, -- 迁移的版本号
    name TEXT NOT NULL,     -- 迁移的描述性名称
    applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')) -- 应用迁移的时间戳
);
`;

// 2. 定义迁移列表
// 注意：这里的迁移应该代表数据库模式从某个已知状态到下一个状态的变化。
// 初始模式通常在 database.ts 中通过 schema.registry.ts 创建。
// 这里的迁移应该从版本 1 开始，代表初始模式创建后的第一个变更。
interface Migration {
  id: number;
  name: string;
  sql: string; // 可以是多条 SQL 语句，用 ; 分隔。db.exec 会处理。
  check?: (db: Database) => Promise<boolean>; // 可选的前置检查函数
  // 可选的事务外预执行 SQL（如 PRAGMA，SQLite 要求此类语句在事务外执行）
  preSql?: string;
}

interface TableInfoColumn {
  name: string;
}

interface TableCreateSqlRow {
  sql: string | null;
}

// 辅助函数：检查表是否存在
const tableExists = async (db: Database, tableName: string): Promise<boolean> => {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
      [tableName],
      (err, row) => {
        if (err) reject(err);
        else resolve(!!row);
      },
    );
  });
};

// 辅助函数：检查列是否存在
// 仅允许合法的 SQLite 标识符，防止 PRAGMA 语句中的注入
const VALID_TABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

const columnExists = async (
  db: Database,
  tableName: string,
  columnName: string,
): Promise<boolean> => {
  if (!VALID_TABLE_NAME.test(tableName)) {
    throw new Error(`无效的表名: "${tableName}"`);
  }
  return new Promise((resolve, reject) => {
    db.all(`PRAGMA table_info(${tableName})`, (err, columns: TableInfoColumn[]) => {
      if (err) reject(err);
      else resolve(columns.some((col) => col.name === columnName));
    });
  });
};

// 辅助函数：获取表的创建 SQL
const getTableCreateSQL = async (db: Database, tableName: string): Promise<string | null> => {
  return new Promise((resolve, reject) => {
    db.get(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name=?",
      [tableName],
      (err, row: TableCreateSqlRow) => {
        if (err) reject(err);
        else resolve(row ? row.sql : null);
      },
    );
  });
};

const definedMigrations: Migration[] = [
  {
    id: 1,
    name: 'Add ssh_keys table and update connections table for SSH key management',
    check: async (db: Database): Promise<boolean> => {
      const sshKeysTableExists = await tableExists(db, 'ssh_keys');
      const connectionsTableExists = await tableExists(db, 'connections'); // 确保 connections 表存在再检查列
      const sshKeyIdColumnExists = connectionsTableExists
        ? await columnExists(db, 'connections', 'ssh_key_id')
        : false;
      // 如果 ssh_keys 表不存在 或 connections 表的 ssh_key_id 列不存在，则需要运行迁移
      return !sshKeysTableExists || !sshKeyIdColumnExists;
    },
    sql: `
            -- 创建 ssh_keys 表 (使用 IF NOT EXISTS 保证幂等性)
            CREATE TABLE IF NOT EXISTS ssh_keys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                encrypted_private_key TEXT NOT NULL,
                encrypted_passphrase TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );

            -- 为 connections 表添加 ssh_key_id 列及外键 (如果列不存在)
            -- 注意: 直接 ALTER TABLE 添加列在列已存在时会抛出 "duplicate column name" 错误。
            --       迁移运行器 (runMigrations) 已配置为忽略此特定错误。
            ALTER TABLE connections ADD COLUMN ssh_key_id INTEGER NULL REFERENCES ssh_keys(id) ON DELETE SET NULL;

            -- 可选: 对旧数据进行清理或更新
            -- UPDATE connections SET encrypted_private_key = NULL WHERE encrypted_private_key = ''; -- 示例
            -- UPDATE connections SET encrypted_passphrase = NULL WHERE encrypted_passphrase = ''; -- 示例
        `,
  },
  // --- Quick Command Tags Migrations ---
  {
    id: 2,
    name: 'Create quick_command_tags table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'quick_command_tags');
      return !tableAlreadyExists; // Only run if the table does NOT exist
    },
    sql: `
            CREATE TABLE IF NOT EXISTS quick_command_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL UNIQUE,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `,
  },
  {
    id: 3,
    name: 'Create quick_command_tag_associations table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'quick_command_tag_associations');
      return !tableAlreadyExists; // Only run if the table does NOT exist
    },
    sql: `
            CREATE TABLE IF NOT EXISTS quick_command_tag_associations (
                quick_command_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (quick_command_id, tag_id),
                FOREIGN KEY (quick_command_id) REFERENCES quick_commands(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES quick_command_tags(id) ON DELETE CASCADE
            );
        `,
  },
  {
    id: 4,
    name: 'Add notes column to connections table',
    check: async (db: Database): Promise<boolean> => {
      const notesColumnExists = await columnExists(db, 'connections', 'notes');
      return !notesColumnExists;
    },
    sql: `
            -- Add the notes column to the connections table, allowing NULL values
            ALTER TABLE connections ADD COLUMN notes TEXT NULL;
        `,
  },
  {
    id: 5,
    name: 'Update connections table to allow VNC type in CHECK constraint',
    check: async (db: Database): Promise<boolean> => {
      const createSQL = await getTableCreateSQL(db, 'connections');
      if (createSQL) {
        // 检查 CHECK 约束是否已经包含了 VNC
        // 这会检查 'VNC' 是否是允许的类型之一
        // 例如: CHECK(type IN ('SSH', 'RDP', 'VNC'))
        const constraintRegex = /CHECK\s*\(\s*LOWER\(type\)\s+IN\s*\(([^)]+)\)\s*\)/i; // 兼容大小写不敏感的检查
        const constraintRegexStrict = /CHECK\s*\(\s*type\s+IN\s*\(([^)]+)\)\s*\)/i;

        let match = createSQL.match(constraintRegex);
        if (!match) {
          match = createSQL.match(constraintRegexStrict);
        }

        if (match && match[1]) {
          const allowedTypes = match[1]
            .split(',')
            .map((t) => t.trim().replace(/'/g, '').toLowerCase());
          return !allowedTypes.includes('vnc'); // 如果 'vnc' 不在允许类型中，则需要运行迁移
        }
        // 如果没有找到明确的 CHECK 约束或格式不匹配，保守地运行迁移
        logger.warn(
          '[Migrations] Check for VNC in connections.type: Could not parse CHECK constraint from SQL. Assuming migration is needed.',
        );
        return true;
      }
      logger.warn(
        '[Migrations] Check for VNC in connections.type: Could not get table create SQL. Assuming migration is needed.',
      );
      return true; // 如果表不存在或无法获取 SQL，则运行迁移
    },
    sql: `
            PRAGMA foreign_keys=off;

            -- 步骤 1: 重命名旧表
            ALTER TABLE connections RENAME TO connections_old_for_vnc_constraint_update;
            ALTER TABLE connection_tags RENAME TO connection_tags_old_for_vnc_constraint_update;

            -- 步骤 2: 创建新表 (与 schema.ts 中的定义一致)
            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                type TEXT NOT NULL CHECK(type IN ('SSH', 'RDP', 'VNC')) DEFAULT 'SSH',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL CHECK(auth_method IN ('password', 'key')),
                encrypted_password TEXT NULL,
                encrypted_private_key TEXT NULL,
                encrypted_passphrase TEXT NULL,
                proxy_id INTEGER NULL,
                ssh_key_id INTEGER NULL,
                notes TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                last_connected_at INTEGER NULL,
                FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
                FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
            );

            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (connection_id, tag_id),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );

            -- 步骤 3: 从旧表复制数据到新表
            INSERT INTO connections (
                id, name, type, host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes, created_at, updated_at, last_connected_at
            )
            SELECT
                id, name,
                CASE
                    WHEN UPPER(type) = 'RDP' THEN 'RDP'
                    WHEN UPPER(type) = 'SSH' THEN 'SSH'
                    WHEN UPPER(type) = 'VNC' THEN 'VNC'
                    ELSE 'SSH'
                END,
                host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes, created_at, updated_at, last_connected_at
            FROM connections_old_for_vnc_constraint_update;

            INSERT INTO connection_tags (connection_id, tag_id)
            SELECT connection_id, tag_id FROM connection_tags_old_for_vnc_constraint_update;

            -- 步骤 4: 删除旧表
            DROP TABLE connections_old_for_vnc_constraint_update;
            DROP TABLE connection_tags_old_for_vnc_constraint_update;

            PRAGMA foreign_keys=on;

            ANALYZE; -- 重新分析数据库模式
        `,
  },
  {
    id: 6,
    name: 'Create passkeys table for WebAuthn credentials',
    check: async (db: Database): Promise<boolean> => {
      const passkeysTableAlreadyExists = await tableExists(db, 'passkeys');
      return !passkeysTableAlreadyExists;
    },
    sql: `
            CREATE TABLE IF NOT EXISTS passkeys (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                credential_id TEXT UNIQUE NOT NULL, -- Base64URL encoded
                public_key TEXT NOT NULL, -- COSE public key, stored as Base64URL or HEX
                counter INTEGER NOT NULL,
                transports TEXT, -- JSON array of transports e.g. ["usb", "nfc", "ble", "internal"]
                name TEXT NULL, -- User-friendly name for the passkey
                backed_up BOOLEAN NOT NULL DEFAULT FALSE, -- Stored as 0 or 1
                last_used_at INTEGER NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            );
        `,
  },
  {
    id: 7,
    name: 'Create path_history table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'path_history');
      return !tableAlreadyExists;
    },
    sql: `
            CREATE TABLE IF NOT EXISTS path_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT NOT NULL,
                timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `,
  },
  {
    id: 8,
    name: 'Create favorite_paths table',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'favorite_paths');
      return !tableAlreadyExists; // Only run if the table does NOT exist
    },
    sql: `
            CREATE TABLE IF NOT EXISTS favorite_paths (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                path TEXT NOT NULL,
                last_used_at INTEGER NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
        `,
  },
  {
    id: 9,
    name: 'Add jump_chain and proxy_type columns to connections table',
    sql: `
            ALTER TABLE connections ADD COLUMN jump_chain TEXT NULL;
            ALTER TABLE connections ADD COLUMN proxy_type TEXT NULL;
        `,
    check: async (db: Database): Promise<boolean> => {
      const jumpChainColumnExists = await columnExists(db, 'connections', 'jump_chain');
      const proxyTypeColumnExists = await columnExists(db, 'connections', 'proxy_type');
      return !jumpChainColumnExists || !proxyTypeColumnExists;
    },
  },
  {
    id: 10,
    name: 'Add variables column to quick_commands table',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(db, 'quick_commands', 'variables');
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE quick_commands ADD COLUMN variables TEXT NULL;
        `,
  },
  {
    id: 11,
    name: 'Add force_keyboard_interactive column to connections table',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(
        db,
        'connections',
        'force_keyboard_interactive',
      );
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE connections ADD COLUMN force_keyboard_interactive BOOLEAN NOT NULL DEFAULT FALSE;
        `,
  },
  {
    id: 12,
    name: 'Add user_id column to audit_logs table',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(db, 'audit_logs', 'user_id');
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE audit_logs ADD COLUMN user_id INTEGER NULL;
            CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
        `,
  },
  {
    id: 13,
    name: 'Add asn column to ip_geo_cache table',
    check: async (db: Database): Promise<boolean> => {
      const columnAlreadyExists = await columnExists(db, 'ip_geo_cache', 'asn');
      return !columnAlreadyExists;
    },
    sql: `
            ALTER TABLE ip_geo_cache ADD COLUMN asn TEXT NOT NULL DEFAULT '';
        `,
  },
  {
    id: 14,
    name: 'Add history uniqueness/time indexes and deduplicate history rows',
    check: async (db: Database): Promise<boolean> => {
      const indexExists = (name: string): Promise<boolean> =>
        new Promise((resolve, reject) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
            [name],
            (err, row) => (err ? reject(err) : resolve(!!row)),
          );
        });
      const [cmdUnique, pathUnique, connLastConnected] = await Promise.all([
        indexExists('idx_command_history_command_unique'),
        indexExists('idx_path_history_path_unique'),
        indexExists('idx_connections_last_connected_at'),
      ]);
      return !cmdUnique || !pathUnique || !connLastConnected;
    },
    sql: `
            -- 命令历史去重：保留每个 command 最新的一条
            DELETE FROM command_history
            WHERE id IN (
              SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY command ORDER BY timestamp DESC, id DESC) AS rn
                FROM command_history
              ) t
              WHERE t.rn > 1
            );

            -- 路径历史去重：保留每个 path 最新的一条
            DELETE FROM path_history
            WHERE id IN (
              SELECT id FROM (
                SELECT id,
                       ROW_NUMBER() OVER (PARTITION BY path ORDER BY timestamp DESC, id DESC) AS rn
                FROM path_history
              ) t
              WHERE t.rn > 1
            );

            CREATE UNIQUE INDEX IF NOT EXISTS idx_command_history_command_unique ON command_history(command);
            CREATE INDEX IF NOT EXISTS idx_command_history_timestamp_desc ON command_history(timestamp DESC);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_path_history_path_unique ON path_history(path);
            CREATE INDEX IF NOT EXISTS idx_path_history_timestamp_desc ON path_history(timestamp DESC);
            CREATE INDEX IF NOT EXISTS idx_connections_last_connected_at ON connections(last_connected_at DESC);
        `,
  },
  {
    id: 15,
    name: 'Create event_logs table for event persistence',
    check: async (db: Database): Promise<boolean> => {
      const tableAlreadyExists = await tableExists(db, 'event_logs');
      return !tableAlreadyExists;
    },
    sql: `
            CREATE TABLE IF NOT EXISTS event_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                event_type TEXT NOT NULL,
                user_id INTEGER NULL,
                payload TEXT NOT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
            );
            CREATE INDEX IF NOT EXISTS idx_event_logs_event_type ON event_logs(event_type);
            CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_event_logs_user_id ON event_logs(user_id);
        `,
  },
  {
    id: 16,
    name: 'Add performance indexes for missing tables',
    check: async (db: Database): Promise<boolean> => {
      const indexExists = (name: string): Promise<boolean> =>
        new Promise((resolve, reject) => {
          db.get(
            "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
            [name],
            (err, row) => (err ? reject(err) : resolve(!!row)),
          );
        });
      const [idx1, idx2, idx3, idx4] = await Promise.all([
        indexExists('idx_proxies_name'),
        indexExists('idx_notification_settings_channel_type'),
        indexExists('idx_favorite_paths_last_used'),
        indexExists('idx_quick_commands_usage_count'),
      ]);
      return !idx1 || !idx2 || !idx3 || !idx4;
    },
    sql: `
            -- proxies 表：按名称查询代理
            CREATE INDEX IF NOT EXISTS idx_proxies_name ON proxies(name);

            -- notification_settings 表：按渠道类型查询
            CREATE INDEX IF NOT EXISTS idx_notification_settings_channel_type ON notification_settings(channel_type);

            -- favorite_paths 表：按最后使用时间排序
            CREATE INDEX IF NOT EXISTS idx_favorite_paths_last_used ON favorite_paths(last_used_at DESC);

            -- quick_commands 表：按使用频率排序
            CREATE INDEX IF NOT EXISTS idx_quick_commands_usage_count ON quick_commands(usage_count DESC);
        `,
  },
  {
    id: 17,
    name: 'Add priority column to batch_tasks',
    check: async (db: Database): Promise<boolean> => {
      return !(await columnExists(db, 'batch_tasks', 'priority'));
    },
    sql: `
            ALTER TABLE batch_tasks ADD COLUMN priority TEXT NOT NULL DEFAULT 'normal'
              CHECK(priority IN ('low', 'normal', 'high', 'urgent'));
            CREATE INDEX IF NOT EXISTS idx_batch_tasks_priority ON batch_tasks(priority);
        `,
  },
  {
    id: 18,
    name: 'Fix Telnet CHECK constraint and add missing FK indexes',
    check: async (db: Database): Promise<boolean> => {
      try {
        const row = await new Promise<{ sql: string } | undefined>((resolve, reject) => {
          db.get(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='connections'",
            (err, r: { sql: string } | undefined) => (err ? reject(err) : resolve(r)),
          );
        });
        if (!row?.sql) return true;
        // 如果已包含 Telnet，则无需迁移
        return !row.sql.includes("'Telnet'");
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
        return true;
      }
    },
    sql: `

            -- 步骤 1: 重命名旧表
            ALTER TABLE connections RENAME TO connections_old_for_telnet_fix;
            ALTER TABLE connection_tags RENAME TO connection_tags_old_for_telnet_fix;

            -- 步骤 2: 创建新表，包含 Telnet 的 CHECK 约束
            CREATE TABLE connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NULL,
                type TEXT NOT NULL CHECK(type IN ('SSH', 'RDP', 'VNC', 'Telnet')) DEFAULT 'SSH',
                host TEXT NOT NULL,
                port INTEGER NOT NULL,
                username TEXT NOT NULL,
                auth_method TEXT NOT NULL CHECK(auth_method IN ('password', 'key')),
                encrypted_password TEXT NULL,
                encrypted_private_key TEXT NULL,
                encrypted_passphrase TEXT NULL,
                proxy_id INTEGER NULL,
                ssh_key_id INTEGER NULL,
                notes TEXT NULL,
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                last_connected_at INTEGER NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                proxy_type TEXT NULL CHECK(proxy_type IN ('proxy', 'jump')),
                jump_chain TEXT NULL,
                force_keyboard_interactive INTEGER NOT NULL DEFAULT 0,
                is_monitored INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
                FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
            );

            -- 步骤 3: 复制数据（显式列清单，避免旧表列顺序不匹配）
            -- 注意：旧表可能缺少 sort_order、is_monitored 列（初始 schema 未包含），使用字面量 0 作为默认值
            INSERT INTO connections (
                id, name, type, host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes,
                created_at, updated_at, last_connected_at,
                sort_order, proxy_type, jump_chain, force_keyboard_interactive, is_monitored
            )
            SELECT
                id, name, type, host, port, username, auth_method,
                encrypted_password, encrypted_private_key, encrypted_passphrase,
                proxy_id, ssh_key_id, notes,
                created_at, updated_at, last_connected_at,
                0,
                proxy_type,
                jump_chain,
                COALESCE(force_keyboard_interactive, 0),
                0
            FROM connections_old_for_telnet_fix;

            -- 步骤 4: 重建 connection_tags 表
            CREATE TABLE connection_tags (
                connection_id INTEGER NOT NULL,
                tag_id INTEGER NOT NULL,
                PRIMARY KEY (connection_id, tag_id),
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
                FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
            );
            INSERT INTO connection_tags (connection_id, tag_id)
            SELECT connection_id, tag_id FROM connection_tags_old_for_telnet_fix;

            -- 步骤 5: 删除旧表
            DROP TABLE connections_old_for_telnet_fix;
            DROP TABLE connection_tags_old_for_telnet_fix;

            -- 步骤 6: 添加缺失的外键列索引
            CREATE INDEX IF NOT EXISTS idx_connections_proxy_id ON connections(proxy_id);
            CREATE INDEX IF NOT EXISTS idx_connections_ssh_key_id ON connections(ssh_key_id);
            CREATE INDEX IF NOT EXISTS idx_connection_tags_tag_id ON connection_tags(tag_id);
        `,
    // PRAGMA 必须在事务外执行（SQLite 限制），通过 preSql 在 BEGIN TRANSACTION 前运行
    preSql: `
            PRAGMA foreign_keys=off;
    `,
  },
];

/**
 * 运行数据库迁移。
 * 检查当前数据库版本，并按顺序应用所有新的迁移。
 * @param db 数据库实例
 */
export const runMigrations = (db: Database): Promise<void> => {
  return new Promise((resolve, reject) => {
    logger.debug('[Migrations] 开始检查和应用数据库迁移...');

    db.serialize(() => {
      // 步骤 1: 确保 migrations 表存在
      db.run(createMigrationsTableSQL, (err) => {
        if (err) {
          logger.error('[Migrations] 创建 migrations 表失败:', err);
          return reject(new Error(`创建 migrations 表失败: ${err.message}`));
        }
        logger.debug('[Migrations] migrations 表已确保存在。');

        // 步骤 2: 获取当前数据库版本 (已应用的最大迁移 ID)
        db.get(
          'SELECT MAX(id) as currentVersion FROM migrations',
          (queryErr, row: { currentVersion: number | null }) => {
            if (queryErr) {
              logger.error('[Migrations] 查询当前数据库版本失败:', queryErr);
              return reject(new Error(`查询当前数据库版本失败: ${queryErr.message}`));
            }

            const currentVersion = row?.currentVersion ?? 0; // 如果表为空或没有记录，则认为版本为 0
            logger.debug(`[Migrations] 当前数据库版本: ${currentVersion}`);

            // 步骤 3: 确定需要应用的迁移
            const migrationsToApply = definedMigrations
              .filter((m) => m.id > currentVersion)
              .sort((a, b) => a.id - b.id); // 确保按 ID 升序应用

            if (migrationsToApply.length === 0) {
              logger.debug('[Migrations] 数据库已是最新版本，无需迁移。');
              return resolve();
            }

            logger.debug(
              `[Migrations] 发现 ${migrationsToApply.length} 个新迁移需要应用:`,
              migrationsToApply.map((m) => `  #${m.id}: ${m.name}`),
            );

            // 步骤 4: 使用 async/await 方式按顺序应用迁移
            const applyMigrationsSequentially = async () => {
              for (const migration of migrationsToApply) {
                // 使用 for...of 循环
                logger.info(`[Migrations] 应用迁移 #${migration.id}: ${migration.name}...`);

                // 标记是否需要恢复 foreign_keys（preSql 成功执行后置为 true）
                let needsFkRestore = false;

                try {
                  // 执行事务外预 SQL（如 PRAGMA foreign_keys=off，SQLite 要求此类语句在事务外执行）
                  if (migration.preSql) {
                    await new Promise<void>((resolvePre, rejectPre) => {
                      db.exec(migration.preSql as string, (preErr) => {
                        if (preErr) {
                          // 与主 SQL 一致，"duplicate column name" 视为可接受
                          if (preErr.message.includes('duplicate column name')) {
                            logger.warn(
                              `[Migrations] 迁移 #${migration.id} preSql 出现 'duplicate column name'，视为可接受。`,
                            );
                            resolvePre();
                          } else {
                            logger.error(
                              `[Migrations] 迁移 #${migration.id} preSql 执行失败:`,
                              preErr,
                            );
                            rejectPre(
                              new Error(`迁移 #${migration.id} preSql 失败: ${preErr.message}`),
                            );
                          }
                        } else {
                          resolvePre();
                        }
                      });
                    });
                    // preSql 成功执行，标记需要恢复
                    needsFkRestore = true;
                  }

                  // 开始事务
                  await new Promise<void>((resolveTx, rejectTx) => {
                    db.run('BEGIN TRANSACTION', (beginErr) => {
                      if (beginErr) {
                        logger.error(`[Migrations] 开始迁移 #${migration.id} 事务失败:`, beginErr);
                        rejectTx(
                          new Error(`开始迁移 #${migration.id} 事务失败: ${beginErr.message}`),
                        );
                      } else {
                        resolveTx();
                      }
                    });
                  });

                  try {
                    // 步骤 4.1: 执行前置检查 (如果存在)
                    let needsSqlExecution = true;
                    if (migration.check) {
                      logger.debug(`[Migrations] 执行迁移 #${migration.id} 的前置检查...`);
                      needsSqlExecution = await migration.check(db);
                      logger.debug(
                        `[Migrations] 迁移 #${migration.id} 前置检查结果: ${needsSqlExecution ? '需要执行 SQL' : '跳过 SQL 执行'}`,
                      );
                    }

                    if (needsSqlExecution) {
                      // 步骤 4.2: 执行迁移 SQL
                      logger.debug(`[Migrations] 执行迁移 #${migration.id} 的 SQL...`);
                      await new Promise<void>((resolveSql, rejectSql) => {
                        db.exec(migration.sql, (execErr) => {
                          if (execErr) {
                            // 特别处理 "duplicate column name" 错误
                            if (execErr.message.includes('duplicate column name')) {
                              logger.warn(
                                `[Migrations] 迁移 #${migration.id} SQL 执行时出现 'duplicate column name' 错误，视为可接受并继续。`,
                              );
                              resolveSql();
                            } else {
                              logger.error(
                                `[Migrations] 执行迁移 #${migration.id} SQL 失败:`,
                                execErr,
                              );
                              rejectSql(execErr);
                            }
                          } else {
                            resolveSql();
                          }
                        });
                      });
                    }

                    // 步骤 4.3: 记录迁移到 migrations 表
                    logger.debug(`[Migrations] 记录迁移 #${migration.id} 到 migrations 表...`);
                    const insertSQL =
                      "INSERT INTO migrations (id, name, applied_at) VALUES (?, ?, strftime('%s', 'now'))";
                    await new Promise<void>((resolveInsert, rejectInsert) => {
                      db.run(insertSQL, [migration.id, migration.name], (insertErr) => {
                        if (insertErr) {
                          logger.error(
                            `[Migrations] 记录迁移 #${migration.id} 到 migrations 表失败:`,
                            insertErr,
                          );
                          rejectInsert(insertErr);
                        } else {
                          resolveInsert();
                        }
                      });
                    });

                    // 步骤 4.4: 提交事务
                    logger.debug(`[Migrations] 提交迁移 #${migration.id} 事务...`);
                    await new Promise<void>((resolveCommit, rejectCommit) => {
                      db.run('COMMIT', (commitErr) => {
                        if (commitErr) {
                          logger.error(
                            `[Migrations] 提交迁移 #${migration.id} 事务失败:`,
                            commitErr,
                          );
                          rejectCommit(commitErr);
                        } else {
                          logger.info(
                            `[Migrations] 迁移 #${migration.id}: ${migration.name} 应用成功 (SQL 可能已跳过)。`,
                          );
                          resolveCommit();
                        }
                      });
                    });
                  } catch (migrationStepError: unknown) {
                    // 捕获 check, exec, insert 或 commit 中的任何错误
                    const migrationStepErrMsg = getErrorMessage(migrationStepError);
                    logger.error(`[Migrations] 迁移 #${migration.id} 步骤失败，正在回滚事务...`);
                    await new Promise<void>((resolveRollback) => {
                      // 用嵌套 try/catch 保护 rollback，避免 rollback 失败掩盖原始错误
                      db.run('ROLLBACK', (rollbackErr) => {
                        if (rollbackErr)
                          logger.error(
                            `[Migrations] 回滚迁移 #${migration.id} 事务失败:`,
                            rollbackErr,
                          );
                        resolveRollback(); // Indicate rollback attempt finished
                      });
                    });

                    // 抛出错误，由 applyMigrationsSequentially().catch(reject) 统一处理
                    // 使用 throw 而非 reject+return，确保外层 finally 完整执行后再 reject
                    throw new Error(`迁移 #${migration.id} 失败: ${migrationStepErrMsg}`);
                  }
                } finally {
                  // 无论成功或失败，只要 preSql 执行过就恢复 foreign_keys
                  // 覆盖所有失败路径：preSql 成功但 BEGIN TRANSACTION 失败、SQL 执行失败、COMMIT 失败等
                  if (needsFkRestore) {
                    await new Promise<void>((resolveRestore) => {
                      db.exec('PRAGMA foreign_keys=on;', (restoreErr) => {
                        if (restoreErr) {
                          logger.warn(
                            `[Migrations] 恢复 foreign_keys=on 失败 (迁移 #${migration.id}):`,
                            restoreErr,
                          );
                        }
                        resolveRestore(); // 即使恢复失败也继续，避免阻塞后续迁移
                      });
                    });
                  }
                }
              }

              // 所有迁移成功应用
              logger.info('[Migrations] 所有新迁移已成功应用！');
              resolve();
            };

            // 开始按顺序应用迁移
            applyMigrationsSequentially().catch(reject); // 将 applyMigrationsSequentially 的拒绝传递给外层 Promise
          },
        );
      });
    });
  });
};
