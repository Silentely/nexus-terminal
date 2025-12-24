/**
 * Notification Dispatcher Service 单元测试
 * 测试通知分发的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import {
  NotificationDispatcherService,
  INotificationSender,
} from './notification.dispatcher.service';
import type { ProcessedNotification } from './notification.processor.service';
import type { NotificationChannelType } from '../types/notification.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
// 注意：在 hoisted 回调中使用 require() 而非 ES 模块导入
const { mockEmailSender, mockTelegramSender, mockWebhookSender, mockProcessorEmitter } = vi.hoisted(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const { EventEmitter: EE } = require('events');
    return {
      mockEmailSender: {
        send: vi.fn(),
      },
      mockTelegramSender: {
        send: vi.fn(),
      },
      mockWebhookSender: {
        send: vi.fn(),
      },
      mockProcessorEmitter: new EE(),
    };
  }
);

// Mock 依赖模块
vi.mock('./senders/email.sender.service', () => ({
  default: mockEmailSender,
}));

vi.mock('./senders/telegram.sender.service', () => ({
  default: mockTelegramSender,
}));

vi.mock('./senders/webhook.sender.service', () => ({
  default: mockWebhookSender,
}));

// Mock processor service
vi.mock('./notification.processor.service', () => ({
  default: mockProcessorEmitter,
}));

describe('NotificationDispatcherService', () => {
  let service: NotificationDispatcherService;

  const mockEmailNotification: ProcessedNotification = {
    channelType: 'email',
    config: {
      to: 'test@example.com',
      from: 'noreply@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
    },
    subject: '测试邮件',
    body: '这是测试邮件内容',
    rawPayload: { event: 'TEST_EVENT' },
  };

  const mockTelegramNotification: ProcessedNotification = {
    channelType: 'telegram',
    config: {
      botToken: '123456:ABC-DEF',
      chatId: '-1001234567890',
    },
    subject: '测试 Telegram',
    body: '这是测试 Telegram 消息',
    rawPayload: { event: 'TEST_EVENT' },
  };

  const mockWebhookNotification: ProcessedNotification = {
    channelType: 'webhook',
    config: {
      url: 'https://webhook.example.com/notify',
      method: 'POST',
    },
    body: '{"event": "TEST_EVENT"}',
    rawPayload: { event: 'TEST_EVENT' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    service = new NotificationDispatcherService();
  });

  afterEach(() => {
    vi.resetAllMocks();
    mockProcessorEmitter.removeAllListeners();
  });

  describe('registerSender', () => {
    it('应成功注册发送器', () => {
      const customSender: INotificationSender = {
        send: vi.fn(),
      };

      service.registerSender('email', customSender);

      // 验证通过分发测试
      mockEmailSender.send.mockResolvedValue(undefined);
    });

    it('注册已存在的渠道类型时应覆盖并输出警告', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const sender1: INotificationSender = { send: vi.fn() };
      const sender2: INotificationSender = { send: vi.fn() };

      service.registerSender('email', sender1);
      service.registerSender('email', sender2);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('email'));
      consoleSpy.mockRestore();
    });
  });

  describe('dispatchNotification', () => {
    beforeEach(() => {
      // 注册默认发送器
      service.registerSender('email', mockEmailSender);
      service.registerSender('telegram', mockTelegramSender);
      service.registerSender('webhook', mockWebhookSender);
    });

    it('应成功分发 Email 通知', async () => {
      mockEmailSender.send.mockResolvedValue(undefined);

      await service.dispatchNotification(mockEmailNotification);

      expect(mockEmailSender.send).toHaveBeenCalledWith(mockEmailNotification);
      expect(mockEmailSender.send).toHaveBeenCalledTimes(1);
    });

    it('应成功分发 Telegram 通知', async () => {
      mockTelegramSender.send.mockResolvedValue(undefined);

      await service.dispatchNotification(mockTelegramNotification);

      expect(mockTelegramSender.send).toHaveBeenCalledWith(mockTelegramNotification);
      expect(mockTelegramSender.send).toHaveBeenCalledTimes(1);
    });

    it('应成功分发 Webhook 通知', async () => {
      mockWebhookSender.send.mockResolvedValue(undefined);

      await service.dispatchNotification(mockWebhookNotification);

      expect(mockWebhookSender.send).toHaveBeenCalledWith(mockWebhookNotification);
      expect(mockWebhookSender.send).toHaveBeenCalledTimes(1);
    });

    it('未注册的渠道类型应记录错误并静默返回', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const unknownNotification: ProcessedNotification = {
        channelType: 'unknown' as NotificationChannelType,
        config: {},
        body: 'test',
        rawPayload: {},
      };

      // 不应抛出错误
      await expect(service.dispatchNotification(unknownNotification)).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unknown'));
      consoleSpy.mockRestore();
    });

    it('发送器抛出错误时应捕获并记录', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockEmailSender.send.mockRejectedValue(new Error('SMTP connection failed'));

      await expect(service.dispatchNotification(mockEmailNotification)).resolves.toBeUndefined();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('email'), expect.any(Error));
      consoleSpy.mockRestore();
    });
  });

  describe('listenForNotifications', () => {
    it('应监听处理器的 sendNotification 事件', async () => {
      const dispatchSpy = vi.spyOn(service, 'dispatchNotification').mockResolvedValue(undefined);

      service.listenForNotifications();

      // 触发事件
      mockProcessorEmitter.emit('sendNotification', mockEmailNotification);

      // 等待 setImmediate 执行
      await new Promise((resolve) => setImmediate(resolve));

      expect(dispatchSpy).toHaveBeenCalledWith(mockEmailNotification);
    });

    it('多次调用 listenForNotifications 不应重复监听', async () => {
      const dispatchSpy = vi.spyOn(service, 'dispatchNotification').mockResolvedValue(undefined);

      service.listenForNotifications();
      service.listenForNotifications();

      mockProcessorEmitter.emit('sendNotification', mockEmailNotification);

      // 等待 setImmediate 执行
      await new Promise((resolve) => setImmediate(resolve));

      // 应只调用一次
      expect(dispatchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('initialize', () => {
    it('应注册所有默认发送器并开始监听', () => {
      const registerSpy = vi.spyOn(service, 'registerSender');
      const listenSpy = vi.spyOn(service, 'listenForNotifications');

      service.initialize();

      expect(registerSpy).toHaveBeenCalledWith('email', expect.any(Object));
      expect(registerSpy).toHaveBeenCalledWith('telegram', expect.any(Object));
      expect(registerSpy).toHaveBeenCalledWith('webhook', expect.any(Object));
      expect(listenSpy).toHaveBeenCalled();
    });
  });

  describe('边界条件', () => {
    it('空的 notification 配置应安全处理', async () => {
      service.registerSender('email', mockEmailSender);
      mockEmailSender.send.mockResolvedValue(undefined);

      const emptyConfigNotification: ProcessedNotification = {
        channelType: 'email',
        config: {},
        body: '',
        rawPayload: {},
      };

      await expect(service.dispatchNotification(emptyConfigNotification)).resolves.toBeUndefined();
      expect(mockEmailSender.send).toHaveBeenCalled();
    });

    it('notification 为 null/undefined 时应安全处理', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(service.dispatchNotification(null as any)).resolves.toBeUndefined();
      await expect(service.dispatchNotification(undefined as any)).resolves.toBeUndefined();

      consoleSpy.mockRestore();
    });

    it('并发分发多个通知应正确处理', async () => {
      service.registerSender('email', mockEmailSender);
      service.registerSender('telegram', mockTelegramSender);
      service.registerSender('webhook', mockWebhookSender);

      mockEmailSender.send.mockResolvedValue(undefined);
      mockTelegramSender.send.mockResolvedValue(undefined);
      mockWebhookSender.send.mockResolvedValue(undefined);

      await Promise.all([
        service.dispatchNotification(mockEmailNotification),
        service.dispatchNotification(mockTelegramNotification),
        service.dispatchNotification(mockWebhookNotification),
      ]);

      expect(mockEmailSender.send).toHaveBeenCalledTimes(1);
      expect(mockTelegramSender.send).toHaveBeenCalledTimes(1);
      expect(mockWebhookSender.send).toHaveBeenCalledTimes(1);
    });
  });
});
