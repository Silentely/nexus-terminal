// 定义审计日志记录的操作类型
export type AuditLogActionType =
  // Authentication
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | '2FA_ENABLED'
  | '2FA_DISABLED'
  // Passkey Events
  | 'PASSKEY_REGISTERED'
  | 'PASSKEY_AUTH_SUCCESS'
  | 'PASSKEY_AUTH_FAILURE'
  | 'PASSKEY_DELETED'
  | 'PASSKEY_DELETE_UNAUTHORIZED'
  | 'PASSKEY_NAME_UPDATED'
  | 'PASSKEY_NAME_UPDATE_UNAUTHORIZED'

  // Connections
  | 'CONNECTION_CREATED'
  | 'CONNECTION_UPDATED'
  | 'CONNECTION_DELETED'

  // Proxies
  | 'PROXY_CREATED'
  | 'PROXY_UPDATED'
  | 'PROXY_DELETED'

  // Tags
  | 'TAG_CREATED'
  | 'TAG_UPDATED'
  | 'TAG_DELETED'
  | 'CONNECTIONS_TAG_ADDED'
  | 'CONNECTIONS_TAG_REMOVED'

  // Settings
  | 'SETTINGS_UPDATED' // General settings update
  | 'IP_WHITELIST_UPDATED' // Specific setting update
  | 'CAPTCHA_SETTINGS_UPDATED'

  // Notifications
  | 'NOTIFICATION_SETTING_CREATED'
  | 'NOTIFICATION_SETTING_UPDATED'
  | 'NOTIFICATION_SETTING_DELETED'

  // SSH Actions (via WebSocket)
  //   - SSH_CONNECT_SUCCESS: { userId?: number, username?: string, connectionId: number, connectionName: string, sessionId: string, ip?: string }
  | 'SSH_CONNECT_SUCCESS'
  //   - SSH_CONNECT_FAILURE: { userId?: number, username?: string, connectionId: number, connectionName?: string, ip?: string, reason: string }
  | 'SSH_CONNECT_FAILURE'
  //   - SSH_SHELL_FAILURE:   { userId?: number, username?: string, connectionId: number, connectionName?: string, sessionId: string, ip?: string, reason: string }
  | 'SSH_SHELL_FAILURE'
  //   - SSH_DISCONNECT:      { userId?: number, username?: string, connectionId: number, connectionName?: string, sessionId: string, ip?: string, durationSeconds?: number }
  | 'SSH_DISCONNECT'
  //   - SSH_SESSION_SUSPENDED: { userId?: number, username?: string, connectionId: number, connectionName?: string, sessionId: string, ip?: string }
  | 'SSH_SESSION_SUSPENDED'

  // File Transfer (SFTP / transfers)
  //   - FILE_UPLOAD:   { userId?: number, username?: string, connectionId?: number, sessionId?: string, path?: string, size?: number }
  | 'FILE_UPLOAD'
  //   - FILE_DOWNLOAD: { userId?: number, username?: string, connectionId?: number, sessionId?: string, path?: string, size?: number }
  | 'FILE_DOWNLOAD'

  // Command security
  //   - COMMAND_BLOCKED: { userId?: number, username?: string, connectionId?: number, sessionId?: string, ip?: string, reason?: string, command?: string }
  | 'COMMAND_BLOCKED'

  // System/Error
  | 'DATABASE_MIGRATION'
  | 'ADMIN_SETUP_COMPLETE';

// 审计日志条目的结构 (从数据库读取时)
export interface AuditLogEntry {
  id: number;
  timestamp: number; // Unix timestamp (seconds)
  action_type: AuditLogActionType;
  details: string | null; // JSON string or null
}

// 用于创建日志条目的数据结构
export interface AuditLogData {
  actionType: AuditLogActionType;
  details?: Record<string, any> | string | null;
}
