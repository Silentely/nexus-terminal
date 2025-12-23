// packages/frontend/src/types/audit.types.ts

// 定义审计日志记录的操作类型 (与后端保持一致，但独立定义)
export type AuditLogActionType =
  // Authentication
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | '2FA_ENABLED'
  | '2FA_DISABLED'
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
  // Settings
  | 'SETTINGS_UPDATED'
  | 'IP_WHITELIST_UPDATED'
  // Notifications
  | 'NOTIFICATION_SETTING_CREATED'
  | 'NOTIFICATION_SETTING_UPDATED'
  | 'NOTIFICATION_SETTING_DELETED'
  // SSH Actions
  | 'SSH_CONNECT_SUCCESS'
  | 'SSH_CONNECT_FAILURE'
  | 'SSH_SHELL_FAILURE'
  // System/Error
  | 'DATABASE_MIGRATION'
  | 'ADMIN_SETUP_COMPLETE';

// 前端使用的审计日志条目结构 (对应 API 响应)
export interface AuditLogEntry {
  id: number;
  timestamp: number; // Unix timestamp (seconds)
  action_type: AuditLogActionType;
  details: string | null; // JSON string or null (前端可能需要解析)
}
