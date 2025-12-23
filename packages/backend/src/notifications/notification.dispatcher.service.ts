import notificationProcessorService, {
  ProcessedNotification,
} from './notification.processor.service';
import { NotificationChannelType, NotificationChannelConfig } from '../types/notification.types';

// 导入具体的发送器实现
import telegramSenderService from './senders/telegram.sender.service';
import emailSenderService from './senders/email.sender.service';
import webhookSenderService from './senders/webhook.sender.service';

// 1. 定义通知发送器接口
export interface INotificationSender {
  send(notification: ProcessedNotification): Promise<void>;
}

class NotificationDispatcherService {
  // 使用 Map 来存储不同渠道类型的发送器实例
  private senders: Map<NotificationChannelType, INotificationSender>;

  constructor() {
    this.senders = new Map();
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
      console.warn(
        `[NotificationDispatcher] 通道类型 '${channelType}' 的发送器已注册。将进行覆盖。`
      );
    }
    this.senders.set(channelType, sender);
    console.log(`[NotificationDispatcher] 已为通道类型 '${channelType}' 注册发送器。`);
  }

  private listenForNotifications() {
    notificationProcessorService.on(
      'sendNotification',
      (processedNotification: ProcessedNotification) => {
        // 使用 setImmediate 避免阻塞
        setImmediate(() => {
          this.dispatchNotification(processedNotification).catch((error) => {
            console.error(
              `[NotificationDispatcher] 分发通道 ${processedNotification.channelType} 的通知时出错:`,
              error
            );
          });
        });
      }
    );
    console.log('[NotificationDispatcher] 正在监听处理后的通知。');
  }

  private async dispatchNotification(notification: ProcessedNotification) {
    const sender = this.senders.get(notification.channelType);

    if (!sender) {
      console.warn(
        `[NotificationDispatcher] 没有为通道类型注册发送器: ${notification.channelType}。跳过通知。`
      );
      return;
    }

    console.log(`[NotificationDispatcher] 正在通过 ${notification.channelType} 分发通知`);
    try {
      await sender.send(notification);
      console.log(`[NotificationDispatcher] 已成功通过 ${notification.channelType} 发送通知`);
    } catch (error) {
      console.error(
        `[NotificationDispatcher] 通过 ${notification.channelType} 发送通知失败:`,
        error
      );
      // 这里可以添加失败重试或记录失败状态的逻辑
    }
  }
}

// 创建单例并导出
const notificationDispatcherService = new NotificationDispatcherService();

// 导出接口，以便其他发送器可以实现它
// (或者将接口移到 types 文件中)

export default notificationDispatcherService;
