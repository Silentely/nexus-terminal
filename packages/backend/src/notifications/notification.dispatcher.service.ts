import notificationProcessorService, {
  ProcessedNotification,
} from './notification.processor.service';
import { NotificationChannelType } from '../types/notification.types';
import telegramSenderService from './senders/telegram.sender.service';
import emailSenderService from './senders/email.sender.service';
import webhookSenderService from './senders/webhook.sender.service';
import i18next, { defaultLng, supportedLngs } from '../i18n';
import { settingsService } from '../settings/settings.service';
import { logger } from '../utils/logger';
import type { INotificationSender } from './notification-sender.interface';
import type { NotificationTestResult } from '../types/notification.types';

class NotificationDispatcherService {
  // 使用 Map 来存储不同渠道类型的发送器实例
  private senders: Map<NotificationChannelType, INotificationSender>;
  // 跟踪是否已开始监听
  private isListening: boolean = false;

  constructor() {
    this.senders = new Map();
  }

  /**
   * 初始化服务：注册默认发送器并开始监听
   */
  initialize() {
    // 注册具体的发送器实例
    this.registerSender('telegram', telegramSenderService);
    this.registerSender('email', emailSenderService);
    this.registerSender('webhook', webhookSenderService);

    this.listenForNotifications();
  }

  /**
   * 注册一个通知发送器实例
   * @param channelType 渠道类型
   * @param sender 发送器实例
   */
  registerSender(channelType: NotificationChannelType, sender: INotificationSender) {
    if (this.senders.has(channelType)) {
      logger.warn(
        `[NotificationDispatcher] 通道类型 '${channelType}' 的发送器已注册。将进行覆盖。`,
      );
    }
    this.senders.set(channelType, sender);
    logger.info(`[NotificationDispatcher] 已为通道类型 '${channelType}' 注册发送器。`);
  }

  listenForNotifications() {
    if (this.isListening) {
      return;
    }
    this.isListening = true;
    notificationProcessorService.on(
      'sendNotification',
      (processedNotification: ProcessedNotification) => {
        // 使用 setImmediate 避免阻塞
        setImmediate(() => {
          this.dispatchNotification(processedNotification).catch((error: unknown) => {
            logger.error(
              `[NotificationDispatcher] 分发通道 ${processedNotification.channelType} 的通知时出错:`,
              error,
            );
          });
        });
      },
    );
    logger.info('[NotificationDispatcher] 正在监听处理后的通知。');
  }

  async dispatchNotification(notification: ProcessedNotification): Promise<void> {
    if (!notification) {
      logger.error('[NotificationDispatcher] 收到空的通知对象');
      return;
    }
    const sender = this.senders.get(notification.channelType);

    if (!sender) {
      logger.error(
        `[NotificationDispatcher] 没有为通道类型注册发送器: ${notification.channelType}。跳过通知。`,
      );
      return;
    }

    logger.info(`[NotificationDispatcher] 正在通过 ${notification.channelType} 分发通知`);
    try {
      await sender.send(notification);
      logger.info(`[NotificationDispatcher] 已成功通过 ${notification.channelType} 发送通知`);
    } catch (error: unknown) {
      logger.error(
        `[NotificationDispatcher] 通过 ${notification.channelType} 发送通知失败:`,
        error,
      );
      // 这里可以添加失败重试或记录失败状态的逻辑
    }
  }

  async sendTestNotification(notification: ProcessedNotification): Promise<NotificationTestResult> {
    const userLang = await this.getUserLanguage();
    const sender = this.senders.get(notification.channelType);
    if (!sender) {
      return {
        success: false,
        message: i18next.t('notificationDispatcher.test.senderNotRegistered', {
          lng: userLang,
          channelType: notification.channelType,
          defaultValue: `Notification test failed: no sender registered for ${notification.channelType}.`,
        }),
      };
    }

    try {
      await sender.send(notification);
      return {
        success: true,
        message: i18next.t('notificationDispatcher.test.success', {
          lng: userLang,
          defaultValue: 'Test notification sent successfully.',
        }),
      };
    } catch (error: unknown) {
      logger.error(
        `[NotificationDispatcher] 测试 ${notification.channelType} 通知发送失败:`,
        error,
      );
      const message = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        message: i18next.t('notificationDispatcher.test.failure', {
          lng: userLang,
          message,
          defaultValue: `Test notification failed: ${message}`,
        }),
      };
    }
  }

  private async getUserLanguage(): Promise<string> {
    try {
      const langSetting = await settingsService.getSetting('language');
      if (langSetting && supportedLngs.includes(langSetting)) {
        return langSetting;
      }
    } catch (error: unknown) {
      logger.error(`[NotificationDispatcher] 获取语言设置时出错，使用默认 (${defaultLng}):`, error);
    }
    return defaultLng;
  }
}

// 创建单例并初始化
const notificationDispatcherService = new NotificationDispatcherService();
notificationDispatcherService.initialize();

// 导出类和接口以支持测试
export { NotificationDispatcherService };

export default notificationDispatcherService;
