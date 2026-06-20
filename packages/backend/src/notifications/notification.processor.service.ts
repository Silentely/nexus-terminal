import { EventEmitter } from 'events';
import eventService, { AppEventType, AppEventPayload } from '../services/event.service';
import { NotificationSettingsRepository } from './notification.repository';
import {
  NotificationSetting,
  NotificationEvent,
  NotificationChannelType,
  WebhookConfig,
  EmailConfig,
  TelegramConfig,
  NotificationChannelConfig,
} from '../types/notification.types';
import i18next, { i18nInitializationPromise, defaultLng, supportedLngs } from '../i18n';
import { settingsService } from '../settings/settings.service';
import { logger } from '../utils/logger';

// 定义处理后的通知数据结构
export interface ProcessedNotification {
  channelType: NotificationChannelType;
  config: NotificationChannelConfig; // 包含发送所需的配置，如 URL, Token, SMTP 等
  subject?: string; // 主要用于 Email
  body: string; // 格式化后的通知内容主体
  rawPayload: AppEventPayload; // 原始事件负载，可能需要传递给发送器
}

class NotificationProcessorService extends EventEmitter {
  private repository: NotificationSettingsRepository;
  private isInitialized = false;

  constructor() {
    super();
    this.repository = new NotificationSettingsRepository();
    // 延迟到下一个 tick 初始化，确保 dotenv.config() 已加载环境变量
    // 避免 logger 首次调用时读取到未加载 .env 的环境
    process.nextTick(() => this.initialize());
    this.setMaxListeners(50);
  }

  private async initialize(): Promise<void> {
    try {
      // 先注册监听器，避免启动期间的事件丢失
      logger.debug('[NotificationProcessor] 注册事件监听器...');
      this.registerEventListeners();
      logger.debug('[NotificationProcessor] 等待 i18n 初始化...');
      await i18nInitializationPromise;
      this.isInitialized = true;
      logger.info('[NotificationProcessor] 初始化完成。');
    } catch (error: unknown) {
      logger.error('[NotificationProcessor] 因 i18n 错误导致初始化失败:', error);
    }
  }

  private registerEventListeners() {
    if (this.isInitialized) {
      logger.warn('[NotificationProcessor] 尝试多次注册监听器。');
      return;
    }
    // 监听所有 AppEventType 事件
    // 事件服务内置错误隔离，无需手动 try-catch 包装同步异常
    Object.values(AppEventType).forEach((eventType) => {
      if (eventType !== AppEventType.TestNotification) {
        eventService.onEvent(eventType, (payload) => {
          this.processStandardEvent(eventType, payload).catch((error: unknown) => {
            logger.error(`[NotificationProcessor] 处理事件 ${eventType} 时出错:`, error);
          });
        });
      }
    });
    logger.info('[NotificationProcessor] 已注册监听器。');
  }

  private async processStandardEvent(eventType: AppEventType, payload: AppEventPayload) {
    if (!this.isInitialized) {
      logger.warn(`[NotificationProcessor] 在初始化完成前收到事件 ${eventType}。跳过处理。`);
      return;
    }
    logger.debug(`[NotificationProcessor] 收到标准事件: ${eventType}`, payload);
    const eventKey = eventType as NotificationEvent; // 类型转换，假设 AppEventType 和 NotificationEvent 对应

    try {
      const applicableSettings = await this.repository.getEnabledByEvent(eventKey);
      logger.debug(
        `[NotificationProcessor] 找到 ${applicableSettings.length} 个适用于事件 ${eventKey} 的设置`,
      );

      if (applicableSettings.length === 0) {
        return; // 没有配置需要处理
      }

      // 获取用户语言偏好
      let userLang = defaultLng;
      try {
        const langSetting = await settingsService.getSetting('language');
        if (langSetting && supportedLngs.includes(langSetting)) {
          userLang = langSetting;
        }
      } catch (error: unknown) {
        logger.error(
          `[NotificationProcessor] 获取语言设置时出错，使用默认 (${defaultLng}):`,
          error,
        );
      }

      // 1. 翻译事件名称
      const translatedEvent = i18next.t(`event.${eventKey}`, {
        lng: userLang,
        defaultValue: eventKey,
      });

      for (const setting of applicableSettings) {
        this.processSingleSetting(setting, eventType, payload, translatedEvent, userLang);
      }
    } catch (error: unknown) {
      logger.error(`[NotificationProcessor] 获取事件 ${eventKey} 的设置失败:`, error);
    }
  }

  private processSingleSetting(
    setting: NotificationSetting,
    eventType: AppEventType,
    payload: AppEventPayload,
    translatedEvent: string,
    userLang: string,
  ) {
    try {
      const processedNotification = this.prepareNotificationContent(
        setting,
        eventType,
        payload,
        translatedEvent,
        userLang,
      );

      if (processedNotification) {
        this.emit('sendNotification', processedNotification);
        logger.debug(
          `[NotificationProcessor] 正在为 ${setting.channel_type} 发送 sendNotification (设置 ID: ${setting.id}, 事件: ${eventType})`,
        );
      }
    } catch (error: unknown) {
      logger.error(
        `[NotificationProcessor] 为设置 ID ${setting.id} 和事件 ${eventType} 准备通知时出错:`,
        error,
      );
    }
  }

  private prepareNotificationContent(
    setting: NotificationSetting,
    eventType: AppEventType,
    payload: AppEventPayload,
    translatedEvent: string, // The already translated event name (e.g., "登录成功")
    _lang: string,
  ): ProcessedNotification | null {
    const baseInterpolationData = {
      event: translatedEvent,
      rawEvent: eventType,
      timestamp: payload.timestamp.toISOString(),
      details:
        typeof payload.details === 'object'
          ? JSON.stringify(payload.details, null, 2)
          : payload.details || '',
      userId: payload.userId || 'N/A',
      ...(typeof payload.details === 'object' ? payload.details : {}),
      settingId: payload.details?.settingId,
      settingName: payload.details?.name,
      settingType: payload.details?.type,
    };

    let subject: string | undefined;
    let body: string = '';

    const genericEmailBody = `<p>事件: {event}</p><p>时间: {timestamp}</p><p>用户ID: {userId}</p><p>详情:</p><pre>{details}</pre>`;
    const genericWebhookBody = JSON.stringify({
      event: '{event}',
      timestamp: '{timestamp}',
      userId: '{userId}',
      details: '{details}',
    });
    const genericTelegramBody = `*{event}*\n时间: {timestamp}\n用户ID: {userId}\n详情:\n\`\`\`\n{details}\n\`\`\``;

    switch (setting.channel_type) {
      case 'email':
        const emailConfig = setting.config as EmailConfig;
        subject = translatedEvent;

        const bodyTemplate = emailConfig?.bodyTemplate || genericEmailBody;
        body = this.interpolate(bodyTemplate, baseInterpolationData);
        break;

      case 'webhook':
        const webhookConfig = setting.config as WebhookConfig;
        const webhookTemplate = webhookConfig.bodyTemplate || genericWebhookBody;
        body = this.interpolate(webhookTemplate, baseInterpolationData);
        break;

      case 'telegram':
        const telegramConfig = setting.config as TelegramConfig;
        const telegramTemplate = telegramConfig.messageTemplate || genericTelegramBody;
        body = this.interpolate(telegramTemplate, baseInterpolationData);
        break;

      default:
        logger.warn(`[NotificationProcessor] 不支持的通道类型: ${setting.channel_type}`);
        return null;
    }

    return {
      channelType: setting.channel_type,
      config: setting.config,
      subject,
      body,
      rawPayload: payload,
    };
  }

  /**
   * 简单的字符串模板插值替换
   * @param template 模板字符串，例如 "Hello {name}"
   * @param data 数据对象，例如 { name: "World" }
   * @returns 替换后的字符串
   */
  private interpolate(template: string, data: Record<string, unknown>): string {
    if (!template) return '';
    // 使用正则表达式全局替换 {key} 格式的占位符
    return template.replace(/\{(\w+)\}/g, (match, key) => {
      // 如果 data 中存在对应的 key，则返回值，否则返回原始匹配（例如 "{unknownKey}"）
      return Object.prototype.hasOwnProperty.call(data, key) &&
        data[key] !== null &&
        data[key] !== undefined
        ? String(data[key])
        : match;
    });
  }
}

// 创建单例并导出
const notificationProcessorService = new NotificationProcessorService();

export default notificationProcessorService;
