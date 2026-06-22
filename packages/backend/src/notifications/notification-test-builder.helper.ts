/**
 * 通知测试构建器
 * 负责构建测试通知的 ProcessedNotification 对象
 * 从 NotificationController 提取，便于独立复用和测试
 */
import { AppEventType } from '../types/event.types';
import i18next from '../i18n';
import type {
  NotificationChannelType,
  NotificationChannelConfig,
} from '../types/notification.types';
import type { ProcessedNotification } from './notification.processor.service';

export type TestPayloadDetails = {
  message?: string;
};

/**
 * 构建测试通知对象
 * 根据渠道类型选择模板并插值变量，返回可直接发送的 ProcessedNotification
 */
export function buildTestNotification(
  channelType: NotificationChannelType,
  config: NotificationChannelConfig,
  userId?: number,
  payload?: TestPayloadDetails,
): ProcessedNotification {
  const eventPayload = {
    event: AppEventType.TestNotification,
    timestamp: new Date(),
    details: payload ?? {},
  };
  const formattedDetails = formatTestDetails(eventPayload.details);
  const subject = i18next.t('notificationController.testSubjectFallback', {
    defaultValue: 'Nexus Terminal Test',
  });
  const baseData = {
    event: eventPayload.event,
    timestamp: eventPayload.timestamp.toISOString(),
    details: formattedDetails,
    message: payload?.message || '',
  };
  const genericEmailBody = i18next.t('notificationController.genericEmailBody', {
    defaultValue:
      '<p>Event: {event}</p><p>Timestamp: {timestamp}</p><p>Details:</p><pre>{details}</pre>',
  });
  const genericWebhookBody = '{"event":"{event}","timestamp":"{timestamp}","details":{details}}';
  const genericTelegramBody = i18next.t('notificationController.genericTelegramBody', {
    defaultValue: '*{event}*\nTimestamp: {timestamp}\nDetails:\n```\n{details}\n```',
  });
  let bodyTemplate: string;
  if (channelType === 'email') {
    bodyTemplate = getTestTemplateFromConfig(config, 'bodyTemplate') || genericEmailBody;
  } else if (channelType === 'webhook') {
    bodyTemplate = getTestTemplateFromConfig(config, 'bodyTemplate') || genericWebhookBody;
  } else {
    bodyTemplate = getTestTemplateFromConfig(config, 'messageTemplate') || genericTelegramBody;
  }

  return {
    channelType,
    config,
    subject,
    body: interpolateTestTemplate(bodyTemplate, baseData),
    rawPayload: {
      event: eventPayload.event,
      timestamp: eventPayload.timestamp,
      details: eventPayload.details as Record<string, unknown> | undefined,
      ...(typeof userId === 'number' ? { userId } : {}),
    } as ProcessedNotification['rawPayload'],
  };
}

/**
 * 从配置中提取测试模板，空值或纯空白返回 undefined
 */
function getTestTemplateFromConfig(
  config: NotificationChannelConfig,
  key: 'bodyTemplate' | 'messageTemplate',
): string | undefined {
  if (config && typeof config === 'object') {
    const value = (config as unknown as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value : undefined;
  }
  return undefined;
}

/**
 * 格式化测试详情为 JSON 字符串
 */
function formatTestDetails(details: TestPayloadDetails): string {
  return JSON.stringify(details || {}, null, 2);
}

/**
 * 将模板中的 {key} 占位符替换为对应数据值
 */
function interpolateTestTemplate(template: string, data: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => data[key] ?? match);
}
