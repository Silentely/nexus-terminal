// packages/backend/src/schema.ts

export const createSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createAuditLogsTableSQL = `
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    details TEXT NULL,
    user_id INTEGER NULL
);
`;

// 审计日志索引 - 优化查询性能
export const createAuditLogsIndexesSQL = [
  // 时间戳索引（降序）- 用于按时间倒序查询最新日志
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp DESC);`,
  // 操作类型索引 - 用于按操作类型筛选
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_action_type ON audit_logs(action_type);`,
  // 用户 ID 索引 - 用于按用户筛选日志
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);`,
];

// Passkeys table definition
export const createPasskeysTableSQL = `
CREATE TABLE IF NOT EXISTS passkeys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_id TEXT UNIQUE NOT NULL, -- Base64URL encoded
    public_key TEXT NOT NULL, -- COSE public key, stored as Base64URL or HEX
    counter INTEGER NOT NULL,
    transports TEXT, -- JSON array of transports e.g. ["usb", "nfc", "ble", "internal"]
    name TEXT NULL, -- User-friendly name for the passkey
    backed_up BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_at INTEGER NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const createNotificationSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    channel_type TEXT NOT NULL CHECK(channel_type IN ('webhook', 'email', 'telegram')),
    name TEXT NOT NULL DEFAULT '',
    enabled BOOLEAN NOT NULL DEFAULT false,
    config TEXT NOT NULL DEFAULT '{}', -- JSON string for channel-specific config
    enabled_events TEXT NOT NULL DEFAULT '[]', -- JSON array of event names
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createUsersTableSQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    hashed_password TEXT NOT NULL,
    two_factor_secret TEXT NULL, -- 2FA 密钥列，允许为空
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createProxiesTableSQL = `
CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('SOCKS5', 'HTTP')),
    host TEXT NOT NULL,
    port INTEGER NOT NULL,
    username TEXT NULL,
    auth_method TEXT NOT NULL DEFAULT 'none' CHECK(auth_method IN ('none', 'password', 'key')),
    encrypted_password TEXT NULL,
    encrypted_private_key TEXT NULL,
    encrypted_passphrase TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    UNIQUE(name, type, host, port)
);
`;

export const createConnectionsTableSQL = `
CREATE TABLE IF NOT EXISTS connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL, -- 允许 name 为空
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
    jump_chain TEXT NULL,
    proxy_type TEXT NULL,
    force_keyboard_interactive BOOLEAN NOT NULL DEFAULT FALSE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    last_connected_at INTEGER NULL,
    FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL,
    FOREIGN KEY (ssh_key_id) REFERENCES ssh_keys(id) ON DELETE SET NULL
);
`;

// 连接表索引：优化最近连接查询
export const createConnectionsIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_connections_last_connected_at ON connections(last_connected_at DESC);`,
];

export const createSshKeysTableSQL = `
CREATE TABLE IF NOT EXISTS ssh_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    encrypted_private_key TEXT NOT NULL,
    encrypted_passphrase TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createTagsTableSQL = `
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createConnectionTagsTableSQL = `
CREATE TABLE IF NOT EXISTS connection_tags (
    connection_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (connection_id, tag_id),
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
);
`;

export const createIpBlacklistTableSQL = `
CREATE TABLE IF NOT EXISTS ip_blacklist (
    ip TEXT PRIMARY KEY NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 1,
    last_attempt_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    blocked_until INTEGER NULL -- 封禁截止时间戳 (秒)，NULL 表示未封禁或永久封禁 (根据逻辑决定)
);
`;

export const createCommandHistoryTableSQL = `
CREATE TABLE IF NOT EXISTS command_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

// 命令历史索引：仅时间索引（唯一索引由迁移 #14 创建，避免在旧数据库上因重复数据崩溃）
export const createCommandHistoryIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_command_history_timestamp_desc ON command_history(timestamp DESC);`,
];

export const createPathHistoryTableSQL = `
CREATE TABLE IF NOT EXISTS path_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

// 路径历史索引：仅时间索引（唯一索引由迁移 #14 创建，避免在旧数据库上因重复数据崩溃）
export const createPathHistoryIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_path_history_timestamp_desc ON path_history(timestamp DESC);`,
];

export const createQuickCommandsTableSQL = `
CREATE TABLE IF NOT EXISTS quick_commands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL, -- 名称可选
    command TEXT NOT NULL, -- 指令必选
    usage_count INTEGER NOT NULL DEFAULT 0, -- 使用频率
    variables TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

// --- Quick Command Tags ---

export const createQuickCommandTagsTableSQL = `
CREATE TABLE IF NOT EXISTS quick_command_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createQuickCommandTagAssociationsTableSQL = `
CREATE TABLE IF NOT EXISTS quick_command_tag_associations (
    quick_command_id INTEGER NOT NULL,
    tag_id INTEGER NOT NULL,
    PRIMARY KEY (quick_command_id, tag_id),
    FOREIGN KEY (quick_command_id) REFERENCES quick_commands(id) ON DELETE CASCADE,
    FOREIGN KEY (tag_id) REFERENCES quick_command_tags(id) ON DELETE CASCADE
);
`;

// 从 database.ts 移动过来的，保持一致性
export const createTerminalThemesTableSQL = `
CREATE TABLE IF NOT EXISTS terminal_themes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    theme_type TEXT NOT NULL CHECK(theme_type IN ('preset', 'user')),
    foreground TEXT,
    background TEXT,
    cursor TEXT,
    cursor_accent TEXT,
    selection_background TEXT,
    black TEXT,
    red TEXT,
    green TEXT,
    yellow TEXT,
    blue TEXT,
    magenta TEXT,
    cyan TEXT,
    white TEXT,
    bright_black TEXT,
    bright_red TEXT,
    bright_green TEXT,
    bright_yellow TEXT,
    bright_blue TEXT,
    bright_magenta TEXT,
    bright_cyan TEXT,
    bright_white TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createAppearanceSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS appearance_settings (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;
export const createFavoritePathsTableSQL = `
CREATE TABLE IF NOT EXISTS favorite_paths (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NULL,
    path TEXT NOT NULL,
    last_used_at INTEGER NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

// ========== 批量作业模块 ==========

// 批量任务主表
export const createBatchTasksTableSQL = `
CREATE TABLE IF NOT EXISTS batch_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'in-progress', 'partially-completed', 'completed', 'failed', 'cancelled')),
    concurrency_limit INTEGER NOT NULL DEFAULT 5,
    overall_progress REAL NOT NULL DEFAULT 0,
    total_subtasks INTEGER NOT NULL,
    completed_subtasks INTEGER NOT NULL DEFAULT 0,
    failed_subtasks INTEGER NOT NULL DEFAULT 0,
    cancelled_subtasks INTEGER NOT NULL DEFAULT 0,
    message TEXT NULL,
    payload_json TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    started_at INTEGER NULL,
    ended_at INTEGER NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// 批量任务索引
export const createBatchTasksIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_batch_tasks_user_status ON batch_tasks(user_id, status);`,
  `CREATE INDEX IF NOT EXISTS idx_batch_tasks_updated_at ON batch_tasks(updated_at DESC);`,
];

// 批量子任务表
export const createBatchSubTasksTableSQL = `
CREATE TABLE IF NOT EXISTS batch_subtasks (
    id TEXT PRIMARY KEY NOT NULL,
    task_id TEXT NOT NULL,
    connection_id INTEGER NOT NULL,
    connection_name TEXT NULL,
    command TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('queued', 'connecting', 'running', 'completed', 'failed', 'cancelled')),
    progress REAL NOT NULL DEFAULT 0,
    exit_code INTEGER NULL,
    output TEXT NULL,
    message TEXT NULL,
    started_at INTEGER NULL,
    ended_at INTEGER NULL,
    FOREIGN KEY (task_id) REFERENCES batch_tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
);
`;

// 批量子任务索引
export const createBatchSubTasksIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_batch_subtasks_task ON batch_subtasks(task_id);`,
  `CREATE INDEX IF NOT EXISTS idx_batch_subtasks_task_status ON batch_subtasks(task_id, status);`,
];

// ========== AI 智能运维模块 ==========

// AI 会话表
export const createAISessionsTableSQL = `
CREATE TABLE IF NOT EXISTS ai_sessions (
    id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    title TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// AI 会话索引
export const createAISessionsIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_ai_sessions_user ON ai_sessions(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_ai_sessions_updated ON ai_sessions(updated_at DESC);`,
];

// AI 消息表
export const createAIMessagesTableSQL = `
CREATE TABLE IF NOT EXISTS ai_messages (
    id TEXT PRIMARY KEY NOT NULL,
    session_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    metadata_json TEXT NULL,
    FOREIGN KEY (session_id) REFERENCES ai_sessions(id) ON DELETE CASCADE
);
`;

// AI 消息索引
export const createAIMessagesIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_ai_messages_session ON ai_messages(session_id);`,
  `CREATE INDEX IF NOT EXISTS idx_ai_messages_session_time ON ai_messages(session_id, timestamp ASC);`,
];

// ========== IP 地理定位缓存 ==========

export const createIpGeoCacheTableSQL = `
CREATE TABLE IF NOT EXISTS ip_geo_cache (
    ip TEXT PRIMARY KEY NOT NULL,
    country TEXT NOT NULL DEFAULT '',
    region_name TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    isp TEXT NOT NULL DEFAULT '',
    asn TEXT NOT NULL DEFAULT '',
    provider TEXT NOT NULL DEFAULT 'ip-api',
    queried_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createIpGeoCacheIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_ip_geo_cache_queried_at ON ip_geo_cache(queried_at);`,
];

// ========== 事件日志表 ==========

export const createEventLogsTableSQL = `
CREATE TABLE IF NOT EXISTS event_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    user_id INTEGER NULL,
    payload TEXT NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);
`;

export const createEventLogsIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_event_logs_event_type ON event_logs(event_type);`,
  `CREATE INDEX IF NOT EXISTS idx_event_logs_created_at ON event_logs(created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS idx_event_logs_user_id ON event_logs(user_id);`,
];

// ========== AI 审计模块 ==========

// 审计报告表
export const createAuditReportsTableSQL = `
CREATE TABLE IF NOT EXISTS audit_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    report_type TEXT NOT NULL CHECK(report_type IN ('command_analysis', 'login_analysis', 'full_audit')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'in_progress', 'completed', 'failed')),
    time_range_start INTEGER NOT NULL,
    time_range_end INTEGER NOT NULL,
    summary TEXT NOT NULL DEFAULT '{}',
    anomalies_json TEXT NULL,
    ai_analysis TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// 审计报告索引
export const createAuditReportsIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_audit_reports_user ON audit_reports(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_reports_type_time ON audit_reports(report_type, created_at DESC);`,
];

// 异常检测记录表
export const createAuditAnomaliesTableSQL = `
CREATE TABLE IF NOT EXISTS audit_anomalies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    report_id INTEGER NULL,
    rule_id TEXT NOT NULL,
    severity TEXT NOT NULL CHECK(severity IN ('critical', 'high', 'medium', 'low', 'info')),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence_json TEXT NULL,
    detected_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    FOREIGN KEY (report_id) REFERENCES audit_reports(id) ON DELETE SET NULL
);
`;

// 异常检测索引
export const createAuditAnomaliesIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_audit_anomalies_report ON audit_anomalies(report_id);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_anomalies_severity ON audit_anomalies(severity);`,
  `CREATE INDEX IF NOT EXISTS idx_audit_anomalies_detected ON audit_anomalies(detected_at DESC);`,
];

// AI 分析任务表
export const createAiAuditTasksTableSQL = `
CREATE TABLE IF NOT EXISTS ai_audit_tasks (
    id TEXT PRIMARY KEY NOT NULL,
    user_id INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'completed', 'failed')),
    report_type TEXT NOT NULL,
    progress REAL NOT NULL DEFAULT 0,
    result_json TEXT NULL,
    error TEXT NULL,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

// AI 审计任务索引
export const createAiAuditTasksIndexesSQL = [
  `CREATE INDEX IF NOT EXISTS idx_ai_audit_tasks_user ON ai_audit_tasks(user_id);`,
  `CREATE INDEX IF NOT EXISTS idx_ai_audit_tasks_status ON ai_audit_tasks(status);`,
];

// ========== Pollinations BYOP 集成模块 ==========

// Pollinations 配置表
export const createPollinationsSettingsTableSQL = `
CREATE TABLE IF NOT EXISTS pollinations_settings (
    user_id INTEGER PRIMARY KEY NOT NULL,
    encrypted_app_key TEXT NOT NULL,
    encrypted_user_key TEXT NULL,
    scope TEXT NOT NULL DEFAULT 'usage,keys',
    models TEXT NOT NULL DEFAULT 'openai,claude,gemini',
    budget REAL NOT NULL DEFAULT 5.0,
    expiry INTEGER NOT NULL DEFAULT 604800,
    enabled INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;
