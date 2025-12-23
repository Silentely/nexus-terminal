export type NotificationChannelType = 'webhook' | 'email' | 'telegram';

// Align NotificationEvent with AuditLogActionType as requested
export type NotificationEvent =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGOUT'
  | 'PASSWORD_CHANGED'
  | '2FA_ENABLED'
  | '2FA_DISABLED'
  // Passkey Events
  | 'PASSKEY_REGISTERED'
  | 'PASSKEY_AUTH_SUCCESS' // Could also use LOGIN_SUCCESS with a 'method: passkey' detail
  | 'PASSKEY_AUTH_FAILURE'
  | 'PASSKEY_DELETED'
  | 'CONNECTION_CREATED'
  | 'CONNECTION_UPDATED'
  | 'CONNECTION_DELETED'
  | 'PROXY_CREATED'
  | 'PROXY_UPDATED'
  | 'PROXY_DELETED'
  | 'TAG_CREATED'
  | 'TAG_UPDATED'
  | 'TAG_DELETED'
  | 'SETTINGS_UPDATED'
  | 'IP_WHITELIST_UPDATED'
  | 'IP_BLOCKED'
  | 'NOTIFICATION_SETTING_CREATED'
  | 'NOTIFICATION_SETTING_UPDATED'
  | 'NOTIFICATION_SETTING_DELETED'
  | 'SSH_CONNECT_SUCCESS'
  | 'SSH_CONNECT_FAILURE'
  | 'SSH_SHELL_FAILURE'
  | 'DATABASE_MIGRATION'
  | 'ADMIN_SETUP_COMPLETE';

export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'GET' | 'PUT'; // Default to POST
  headers?: Record<string, string>; // Optional custom headers
  bodyTemplate?: string; // Optional template for the request body (e.g., using placeholders like {{event}}, {{details}})
}

export interface EmailConfig {
  to: string; // Comma-separated list of recipient emails
  bodyTemplate?: string; // Optional body template (plain text)
  // SMTP settings per channel
  smtpHost?: string;
  smtpPort?: number;
  smtpSecure?: boolean; // Use TLS
  smtpUser?: string;
  smtpPass?: string; // Consider encryption or secure storage
  from?: string; // Sender email address
}

export interface TelegramConfig {
  botToken: string; // Consider storing this securely, maybe encrypted or via env vars
  chatId: string; // Target chat ID
  messageTemplate?: string; // Optional message template
  customDomain?: string; // 允许用户自定义 Telegram API 域名
}

export type NotificationChannelConfig = WebhookConfig | EmailConfig | TelegramConfig;

export interface NotificationSetting {
  id?: number;
  channel_type: NotificationChannelType;
  name: string;
  enabled: boolean;
  config: NotificationChannelConfig; // Parsed JSON config
  enabled_events: NotificationEvent[]; // Parsed JSON array
  created_at?: number | string;
  updated_at?: number | string;
}

// Raw data structure from the database before parsing JSON fields
export interface RawNotificationSetting {
  id: number;
  channel_type: NotificationChannelType;
  name: string;
  enabled: number; // SQLite stores BOOLEAN as 0 or 1
  config: string; // JSON string
  enabled_events: string; // JSON string
  created_at: number | string;
  updated_at: number | string;
}

// Type for the data sent with a notification event
export interface NotificationPayload {
  event: NotificationEvent;
  timestamp: number;
  details?: Record<string, any> | string; // Contextual information about the event
}
