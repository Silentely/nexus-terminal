/**
 * 事件系统类型定义
 * 包含事件类型枚举、负载接口、域名分组、中间件和持久化支持
 * 这是事件系统的核心类型文件，避免循环依赖
 */

// ========== 事件类型枚举 ==========

/**
 * 应用事件类型枚举
 * 覆盖认证、连接、SSH、代理、标签、设置、通知、批量任务、备份、Docker、SFTP、系统等全业务域
 */
export enum AppEventType {
  TestNotification = 'testNotification', // 用于测试
  LoginSuccess = 'LOGIN_SUCCESS',
  LoginFailure = 'LOGIN_FAILURE',
  Logout = 'LOGOUT',
  PasswordChanged = 'PASSWORD_CHANGED',
  TwoFactorEnabled = '2FA_ENABLED',
  TwoFactorDisabled = '2FA_DISABLED',
  ConnectionCreated = 'CONNECTION_CREATED',
  ConnectionUpdated = 'CONNECTION_UPDATED',
  ConnectionDeleted = 'CONNECTION_DELETED',
  ProxyCreated = 'PROXY_CREATED',
  ProxyUpdated = 'PROXY_UPDATED',
  ProxyDeleted = 'PROXY_DELETED',
  TagCreated = 'TAG_CREATED',
  TagUpdated = 'TAG_UPDATED',
  TagDeleted = 'TAG_DELETED',
  SettingsUpdated = 'SETTINGS_UPDATED',
  IpWhitelistUpdated = 'IP_WHITELIST_UPDATED',
  IpBlocked = 'IP_BLOCKED',
  NotificationSettingCreated = 'NOTIFICATION_SETTING_CREATED',
  NotificationSettingUpdated = 'NOTIFICATION_SETTING_UPDATED',
  NotificationSettingDeleted = 'NOTIFICATION_SETTING_DELETED',
  SshConnectSuccess = 'SSH_CONNECT_SUCCESS',
  SshConnectFailure = 'SSH_CONNECT_FAILURE',
  SshShellFailure = 'SSH_SHELL_FAILURE',
  SshDisconnect = 'SSH_DISCONNECT',
  SshSessionSuspended = 'SSH_SESSION_SUSPENDED',
  // Telnet 事件
  TelnetConnectSuccess = 'TELNET_CONNECT_SUCCESS',
  TelnetConnectFailure = 'TELNET_CONNECT_FAILURE',
  TelnetDisconnect = 'TELNET_DISCONNECT',
  // Passkey 事件
  PasskeyRegistered = 'PASSKEY_REGISTERED',
  PasskeyAuthSuccess = 'PASSKEY_AUTH_SUCCESS',
  PasskeyAuthFailure = 'PASSKEY_AUTH_FAILURE',
  PasskeyDeleted = 'PASSKEY_DELETED',
  // 批量任务事件
  BatchTaskCreated = 'BATCH_TASK_CREATED',
  BatchTaskCompleted = 'BATCH_TASK_COMPLETED',
  BatchTaskFailed = 'BATCH_TASK_FAILED',
  BatchTaskCancelled = 'BATCH_TASK_CANCELLED',
  // 备份事件
  BackupExportCompleted = 'BACKUP_EXPORT_COMPLETED',
  BackupExportFailed = 'BACKUP_EXPORT_FAILED',
  BackupImportCompleted = 'BACKUP_IMPORT_COMPLETED',
  BackupImportFailed = 'BACKUP_IMPORT_FAILED',
  // Docker 事件
  DockerContainerStarted = 'DOCKER_CONTAINER_STARTED',
  DockerContainerStopped = 'DOCKER_CONTAINER_STOPPED',
  DockerContainerRemoved = 'DOCKER_CONTAINER_REMOVED',
  DockerContainerCommandFailed = 'DOCKER_CONTAINER_COMMAND_FAILED',
  // SFTP 事件
  SftpConnectSuccess = 'SFTP_CONNECT_SUCCESS',
  SftpConnectFailure = 'SFTP_CONNECT_FAILURE',
  // 系统事件
  DatabaseMigration = 'DATABASE_MIGRATION',
  AdminSetupComplete = 'ADMIN_SETUP_COMPLETE',
}

// ========== 事件负载接口 ==========

/**
 * 事件负载通用接口
 * 所有事件负载都基于此接口扩展
 */
export interface AppEventPayload {
  userId?: number; // 事件关联的用户 ID（如果适用）
  timestamp: Date; // 事件发生的时间戳
  details?: Record<string, unknown>; // 事件相关的具体数据
  [key: string]: unknown; // 允许其他任意属性
}

// ========== 事件负载映射 ==========

/**
 * 事件负载映射接口
 * 将每个 AppEventType 映射到其特定的 payload 类型
 * 用于 emitEvent 的类型化重载签名
 */
export interface EventPayloadMap {
  // 认证事件
  [AppEventType.LoginSuccess]: {
    userId: number;
    details: { username: string; clientIp: string; method?: string };
  };
  [AppEventType.LoginFailure]: { details: { username: string; reason: string; clientIp?: string } };
  [AppEventType.Logout]: { userId: number; details?: { reason?: string } };
  [AppEventType.PasswordChanged]: { userId: number; details?: Record<string, unknown> };
  [AppEventType.TwoFactorEnabled]: { userId: number; details?: Record<string, unknown> };
  [AppEventType.TwoFactorDisabled]: { userId: number; details?: Record<string, unknown> };

  // Passkey 事件
  [AppEventType.PasskeyRegistered]: { userId: number; details?: Record<string, unknown> };
  [AppEventType.PasskeyAuthSuccess]: { userId: number; details?: Record<string, unknown> };
  [AppEventType.PasskeyAuthFailure]: { details: { reason: string; clientIp?: string } };
  [AppEventType.PasskeyDeleted]: { userId: number; details?: Record<string, unknown> };

  // 连接事件
  [AppEventType.ConnectionCreated]: {
    userId?: number;
    details: { connectionId: number; connectionName?: string };
  };
  [AppEventType.ConnectionUpdated]: { userId?: number; details: { connectionId: number } };
  [AppEventType.ConnectionDeleted]: { userId?: number; details: { connectionId: number } };

  // 代理事件
  [AppEventType.ProxyCreated]: {
    userId?: number;
    details: { proxyId: number; proxyName?: string };
  };
  [AppEventType.ProxyUpdated]: { userId?: number; details: { proxyId: number } };
  [AppEventType.ProxyDeleted]: { userId?: number; details: { proxyId: number } };

  // 标签事件
  [AppEventType.TagCreated]: { userId?: number; details: { tagId: number; tagName?: string } };
  [AppEventType.TagUpdated]: { userId?: number; details: { tagId: number } };
  [AppEventType.TagDeleted]: { userId?: number; details: { tagId: number } };

  // 设置事件
  [AppEventType.SettingsUpdated]: {
    userId?: number;
    details?: { key?: string; [key: string]: unknown };
  };
  [AppEventType.IpWhitelistUpdated]: { userId?: number; details?: Record<string, unknown> };
  [AppEventType.IpBlocked]: {
    userId?: number;
    details?: {
      ip?: string;
      attempts?: number;
      duration?: number;
      blockedUntil?: string;
      reason?: string;
    };
  };

  // 通知设置事件
  [AppEventType.NotificationSettingCreated]: { userId?: number; details?: Record<string, unknown> };
  [AppEventType.NotificationSettingUpdated]: { userId?: number; details?: Record<string, unknown> };
  [AppEventType.NotificationSettingDeleted]: { userId?: number; details?: Record<string, unknown> };

  // SSH 事件
  [AppEventType.SshConnectSuccess]: {
    userId: number;
    details: { connectionId?: number; connectionName?: string; host?: string; port?: number };
  };
  [AppEventType.SshConnectFailure]: { userId?: number; details: { reason: string; host?: string } };
  [AppEventType.SshShellFailure]: { userId?: number; details: { reason: string } };
  [AppEventType.SshDisconnect]: { userId?: number; details?: { reason?: string } };
  [AppEventType.SshSessionSuspended]: { userId?: number; details?: Record<string, unknown> };

  // Telnet 事件
  [AppEventType.TelnetConnectSuccess]: {
    userId?: number;
    details: { connectionId: number; connectionName?: string; sessionId: string; ip?: string };
  };
  [AppEventType.TelnetConnectFailure]: {
    userId?: number;
    details: { connectionId: number; connectionName?: string; ip?: string; reason: string };
  };
  [AppEventType.TelnetDisconnect]: {
    userId?: number;
    details: {
      connectionId: number;
      connectionName?: string;
      sessionId: string;
      ip?: string;
      durationSeconds?: number;
    };
  };

  // 批量任务事件
  [AppEventType.BatchTaskCreated]: {
    userId: number;
    details: { taskId: string; command: string; targetCount: number };
  };
  [AppEventType.BatchTaskCompleted]: {
    userId: number;
    details: { taskId: string; total: number; succeeded: number; failed: number };
  };
  [AppEventType.BatchTaskFailed]: { userId: number; details: { taskId: string; reason: string } };
  [AppEventType.BatchTaskCancelled]: { userId: number; details: { taskId: string } };

  // 备份事件
  [AppEventType.BackupExportCompleted]: { userId?: number; details?: Record<string, unknown> };
  [AppEventType.BackupExportFailed]: { userId?: number; details: { reason: string } };
  [AppEventType.BackupImportCompleted]: { userId?: number; details?: Record<string, unknown> };
  [AppEventType.BackupImportFailed]: { userId?: number; details: { reason: string } };

  // Docker 事件
  [AppEventType.DockerContainerStarted]: {
    userId?: number;
    details: { containerId: string; containerName?: string };
  };
  [AppEventType.DockerContainerStopped]: {
    userId?: number;
    details: { containerId: string; containerName?: string };
  };
  [AppEventType.DockerContainerRemoved]: {
    userId?: number;
    details: { containerId: string; containerName?: string };
  };
  [AppEventType.DockerContainerCommandFailed]: {
    userId?: number;
    details: { containerId: string; command: string; error: string };
  };

  // SFTP 事件
  [AppEventType.SftpConnectSuccess]: { userId: number; details?: Record<string, unknown> };
  [AppEventType.SftpConnectFailure]: { userId?: number; details: { reason: string } };

  // 系统事件
  [AppEventType.DatabaseMigration]: { details: { migrationId: number; [key: string]: unknown } };
  [AppEventType.AdminSetupComplete]: { details: { adminId: number } };

  // 测试事件
  [AppEventType.TestNotification]: { details?: Record<string, unknown> };
}

// ========== 事件域名分组 ==========

/**
 * 事件域名枚举
 * 用于按业务域分组和过滤事件
 */
export enum EventDomain {
  Auth = 'auth',
  Connection = 'connection',
  Ssh = 'ssh',
  Telnet = 'telnet',
  Proxy = 'proxy',
  Tag = 'tag',
  Settings = 'settings',
  Notification = 'notification',
  Batch = 'batch',
  Backup = 'backup',
  Docker = 'docker',
  Sftp = 'sftp',
  System = 'system',
}

/**
 * 域名到事件类型的映射
 * 将 AppEventType 按业务域分组
 */
export const DOMAIN_EVENTS: Record<EventDomain, readonly AppEventType[]> = {
  [EventDomain.Auth]: [
    AppEventType.LoginSuccess,
    AppEventType.LoginFailure,
    AppEventType.Logout,
    AppEventType.PasswordChanged,
    AppEventType.TwoFactorEnabled,
    AppEventType.TwoFactorDisabled,
    AppEventType.PasskeyRegistered,
    AppEventType.PasskeyAuthSuccess,
    AppEventType.PasskeyAuthFailure,
    AppEventType.PasskeyDeleted,
  ],
  [EventDomain.Connection]: [
    AppEventType.ConnectionCreated,
    AppEventType.ConnectionUpdated,
    AppEventType.ConnectionDeleted,
  ],
  [EventDomain.Ssh]: [
    AppEventType.SshConnectSuccess,
    AppEventType.SshConnectFailure,
    AppEventType.SshShellFailure,
    AppEventType.SshDisconnect,
    AppEventType.SshSessionSuspended,
  ],
  [EventDomain.Telnet]: [
    AppEventType.TelnetConnectSuccess,
    AppEventType.TelnetConnectFailure,
    AppEventType.TelnetDisconnect,
  ],
  [EventDomain.Proxy]: [
    AppEventType.ProxyCreated,
    AppEventType.ProxyUpdated,
    AppEventType.ProxyDeleted,
  ],
  [EventDomain.Tag]: [AppEventType.TagCreated, AppEventType.TagUpdated, AppEventType.TagDeleted],
  [EventDomain.Settings]: [
    AppEventType.SettingsUpdated,
    AppEventType.IpWhitelistUpdated,
    AppEventType.IpBlocked,
    AppEventType.NotificationSettingCreated,
    AppEventType.NotificationSettingUpdated,
    AppEventType.NotificationSettingDeleted,
  ],
  [EventDomain.Notification]: [AppEventType.TestNotification],
  [EventDomain.Batch]: [
    AppEventType.BatchTaskCreated,
    AppEventType.BatchTaskCompleted,
    AppEventType.BatchTaskFailed,
    AppEventType.BatchTaskCancelled,
  ],
  [EventDomain.Backup]: [
    AppEventType.BackupExportCompleted,
    AppEventType.BackupExportFailed,
    AppEventType.BackupImportCompleted,
    AppEventType.BackupImportFailed,
  ],
  [EventDomain.Docker]: [
    AppEventType.DockerContainerStarted,
    AppEventType.DockerContainerStopped,
    AppEventType.DockerContainerRemoved,
    AppEventType.DockerContainerCommandFailed,
  ],
  [EventDomain.Sftp]: [AppEventType.SftpConnectSuccess, AppEventType.SftpConnectFailure],
  [EventDomain.System]: [AppEventType.DatabaseMigration, AppEventType.AdminSetupComplete],
};

// ========== 持久化事件集合 ==========

/**
 * 需要持久化的关键事件集合
 * 这些事件会自动写入 event_logs 表用于审计和回溯
 */
export const PERSISTENT_EVENTS: ReadonlySet<AppEventType> = new Set([
  // 认证事件（安全审计）
  AppEventType.LoginSuccess,
  AppEventType.LoginFailure,
  AppEventType.Logout,
  AppEventType.PasswordChanged,
  AppEventType.TwoFactorEnabled,
  AppEventType.TwoFactorDisabled,
  AppEventType.PasskeyRegistered,
  AppEventType.PasskeyAuthSuccess,
  AppEventType.PasskeyAuthFailure,
  AppEventType.PasskeyDeleted,
  AppEventType.IpBlocked,
  // SSH 事件（访问审计）
  AppEventType.SshConnectSuccess,
  AppEventType.SshConnectFailure,
  AppEventType.SshDisconnect,
  // Docker 破坏性操作
  AppEventType.DockerContainerRemoved,
  // 备份事件（数据生命周期）
  AppEventType.BackupExportCompleted,
  AppEventType.BackupImportCompleted,
  // 系统事件
  AppEventType.DatabaseMigration,
  AppEventType.AdminSetupComplete,
]);

// ========== 中间件类型 ==========

/**
 * 事件中间件函数类型
 * @param eventType 事件类型
 * @param payload 事件负载
 * @param next 调用下一个中间件或执行实际 emit
 */
export type EventMiddleware = (
  eventType: AppEventType,
  payload: AppEventPayload,
  next: () => void,
) => void;

/**
 * 类型化的事件负载
 * 用于在消费者端获得具体的 payload 类型
 */
export type TypedEventPayload<T extends AppEventType> = AppEventPayload & EventPayloadMap[T];
