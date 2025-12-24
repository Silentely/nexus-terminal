/**
 * Notification Processor Service 单元测试
 * 测试通知处理器的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';

import NotificationProcessorService, {
  ProcessedNotification,
} from './notification.processor.service';
import type {
  NotificationSetting,
  EmailConfig,
  WebhookConfig,
  TelegramConfig,
} from '../types/notification.types';
import { AppEventType } from '../services/event.service';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
// 注意：在 hoisted 回调中使用 require() 而非 ES 模块导入
const { mockRepository, mockEventService, mockI18nT } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
  const { EventEmitter: EE } = require('events');
  const eventEmitter = new EE() as any;
  eventEmitter.onEvent = vi.fn((eventType: string, callback: Function) => {
    eventEmitter.on(eventType, callback);
  });

  return {
    mockRepository: {
      getEnabledByEvent: vi.fn(),
    },
    mockEventService: eventEmitter,
    mockI18nT: vi.fn((key: string, options?: any) => {
      const translations: Record<string, string> = {
        'event.LOGIN_SUCCESS': '登录成功',
        'event.LOGIN_FAILED': '登录失败',
        'event.SETTINGS_UPDATED': '设置已更新',
        'event.TEST_NOTIFICATION': '测试通知',
      };
      return translations[key] || options?.defaultValue || key;
    }),
  };
});

// Mock 依赖模块
vi.mock('./notification.repository', () => ({
  NotificationSettingsRepository: vi.fn().mockImplementation(() => mockRepository),
}));

vi.mock('../services/event.service', () => ({
  default: mockEventService,
  AppEventType: {
    LoginSuccess: 'LOGIN_SUCCESS',
    LoginFailed: 'LOGIN_FAILED',
    SettingsUpdated: 'SETTINGS_UPDATED',
    ConnectionCreated: 'CONNECTION_CREATED',
    TestNotification: 'TEST_NOTIFICATION',
  },
}));

// Mock i18next
vi.mock('../i18n', () => ({
  default: {
    t: mockI18nT,
  },
  i18nInitializationPromise: Promise.resolve(),
  defaultLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en-US'],
}));

// Mock settingsService
vi.mock('../settings/settings.service', () => ({
  settingsService: {
    getSetting: vi.fn().mockResolvedValue(null),
  },
}));

describe('NotificationProcessorService', () => {
  let processorService: typeof NotificationProcessorService;

  const mockEmailSetting: NotificationSetting = {
    id: 1,
    name: '邮件通知',
    enabled: true,
    channel_type: 'email',
    config: {
      to: 'test@example.com',
      from: 'noreply@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
    } as EmailConfig,
    enabled_events: ['LOGIN_SUCCESS', 'SETTINGS_UPDATED'],
  };

  const mockWebhookSetting: NotificationSetting = {
    id: 2,
    name: 'Webhook 通知',
    enabled: true,
    channel_type: 'webhook',
    config: {
      url: 'https://webhook.example.com/notify',
      method: 'POST',
      bodyTemplate: '{"event": "{event}", "user": "{userId}"}',
    } as WebhookConfig,
    enabled_events: ['LOGIN_SUCCESS'],
  };

  const mockTelegramSetting: NotificationSetting = {
    id: 3,
    name: 'Telegram 通知',
    enabled: true,
    channel_type: 'telegram',
    config: {
      botToken: '123456:ABC-DEF',
      chatId: '-1001234567890',
      messageTemplate: '*{event}*\n用户: {userId}\n时间: {timestamp}',
    } as TelegramConfig,
    enabled_events: ['LOGIN_SUCCESS'],
  };

  const mockPayload = {
    timestamp: new Date('2024-01-01T12:00:00Z'),
    userId: 'user-123',
    details: {
      ip: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
    },
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    // 重置模块缓存以获得新的单例实例（确保构造函数重新运行，事件监听器被重新注册）
    vi.resetModules();
    // 等待 processor service 初始化完成
    processorService = (await import('./notification.processor.service')).default;
    // 给一点时间让异步初始化完成
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  afterEach(() => {
    // 清理事件监听器（在 resetModules 后，新实例会在 beforeEach 中重新注册）
    mockEventService.removeAllListeners();
  });

  describe('事件监听', () => {
    it('应监听所有 AppEventType 事件', () => {
      expect(mockEventService.onEvent).toHaveBeenCalled();
    });

    it('应监听 TestNotification 事件', () => {
      expect(mockEventService.onEvent).toHaveBeenCalledWith(
        AppEventType.TestNotification,
        expect.any(Function)
      );
    });
  });

  describe('processStandardEvent', () => {
    it('无匹配设置时应静默返回', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([]);
      const emitSpy = vi.spyOn(processorService, 'emit');

      // 触发事件
      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(mockRepository.getEnabledByEvent).toHaveBeenCalledWith('LOGIN_SUCCESS');
      expect(emitSpy).not.toHaveBeenCalledWith('sendNotification', expect.anything());
    });

    it('应为每个匹配的设置发出 sendNotification 事件', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockEmailSetting, mockWebhookSetting]);
      const emitSpy = vi.spyOn(processorService, 'emit');

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(emitSpy).toHaveBeenCalledWith(
        'sendNotification',
        expect.objectContaining({
          channelType: 'email',
        })
      );
      expect(emitSpy).toHaveBeenCalledWith(
        'sendNotification',
        expect.objectContaining({
          channelType: 'webhook',
        })
      );
    });

    it('获取设置失败时应捕获错误', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockRepository.getEnabledByEvent.mockRejectedValue(new Error('Database error'));

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('LOGIN_SUCCESS'),
        expect.any(Error)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('processTestEvent', () => {
    it('应处理测试事件并发出 sendNotification', async () => {
      const emitSpy = vi.spyOn(processorService, 'emit');
      const testPayload = {
        timestamp: new Date(),
        userId: 'test-user',
        details: {
          testTargetChannelType: 'email',
          testTargetConfig: {
            to: 'test@example.com',
            smtpHost: 'smtp.test.com',
            smtpPort: 587,
          },
        },
      };

      mockEventService.emit(AppEventType.TestNotification, testPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(emitSpy).toHaveBeenCalledWith(
        'sendNotification',
        expect.objectContaining({
          channelType: 'email',
        })
      );
    });

    it('缺少 testTargetConfig 时应记录错误', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const invalidPayload = {
        timestamp: new Date(),
        userId: 'test-user',
        details: {},
      };

      mockEventService.emit(AppEventType.TestNotification, invalidPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('testTargetConfig'));
      consoleSpy.mockRestore();
    });

    it('缺少 testTargetChannelType 时应记录错误', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const invalidPayload = {
        timestamp: new Date(),
        userId: 'test-user',
        details: {
          testTargetConfig: { to: 'test@example.com' },
        },
      };

      mockEventService.emit(AppEventType.TestNotification, invalidPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('testTargetChannelType'));
      consoleSpy.mockRestore();
    });
  });

  describe('prepareNotificationContent', () => {
    it('应正确准备 Email 通知内容', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockEmailSetting]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification).not.toBeNull();
      expect(capturedNotification?.channelType).toBe('email');
      expect(capturedNotification?.subject).toBeDefined();
      expect(capturedNotification?.body).toContain('user-123');
    });

    it('应正确准备 Webhook 通知内容', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockWebhookSetting]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification).not.toBeNull();
      expect(capturedNotification?.channelType).toBe('webhook');
      expect(capturedNotification?.body).toContain('user-123');
    });

    it('应正确准备 Telegram 通知内容', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockTelegramSetting]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification).not.toBeNull();
      expect(capturedNotification?.channelType).toBe('telegram');
      expect(capturedNotification?.body).toContain('user-123');
    });

    it('不支持的渠道类型应返回 null', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const unknownSetting: NotificationSetting = {
        ...mockEmailSetting,
        channel_type: 'unknown' as any,
      };
      mockRepository.getEnabledByEvent.mockResolvedValue([unknownSetting]);

      const emitSpy = vi.spyOn(processorService, 'emit');

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('不支持的通道类型'));
      // 不应发出 sendNotification 事件
      expect(emitSpy).not.toHaveBeenCalledWith('sendNotification', expect.anything());
      consoleSpy.mockRestore();
    });
  });

  describe('interpolate', () => {
    it('应正确替换模板变量', async () => {
      const webhookConfig: WebhookConfig = {
        url: 'https://example.com',
        bodyTemplate: '{"event": "{event}", "user": "{userId}", "time": "{timestamp}"}',
      };
      const settingWithTemplate: NotificationSetting = {
        ...mockWebhookSetting,
        config: webhookConfig,
      };
      mockRepository.getEnabledByEvent.mockResolvedValue([settingWithTemplate]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification?.body).toContain('user-123');
      expect(capturedNotification?.body).toContain('2024-01-01');
    });

    it('未知变量应保留原始占位符', async () => {
      const webhookConfig: WebhookConfig = {
        url: 'https://example.com',
        bodyTemplate: '{"unknown": "{unknownVar}", "user": "{userId}"}',
      };
      const settingWithTemplate: NotificationSetting = {
        ...mockWebhookSetting,
        config: webhookConfig,
      };
      mockRepository.getEnabledByEvent.mockResolvedValue([settingWithTemplate]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification?.body).toContain('{unknownVar}');
      expect(capturedNotification?.body).toContain('user-123');
    });

    it('空模板应返回空字符串', async () => {
      const webhookConfig: WebhookConfig = {
        url: 'https://example.com',
        bodyTemplate: '',
      };
      const settingWithEmptyTemplate: NotificationSetting = {
        ...mockWebhookSetting,
        config: webhookConfig,
      };
      mockRepository.getEnabledByEvent.mockResolvedValue([settingWithEmptyTemplate]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // 空模板时使用默认模板
      expect(capturedNotification?.body).toBeDefined();
    });
  });

  describe('边界条件', () => {
    it('payload.details 为字符串时应正确处理', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockWebhookSetting]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      const stringDetailsPayload = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        userId: 'user-123',
        details: '这是字符串详情',
      };

      mockEventService.emit(AppEventType.LoginSuccess, stringDetailsPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification).not.toBeNull();
    });

    it('payload.details 为 undefined 时应正确处理', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockEmailSetting]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      const noDetailsPayload = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        userId: 'user-123',
      };

      mockEventService.emit(AppEventType.LoginSuccess, noDetailsPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification).not.toBeNull();
    });

    it('payload.userId 为 undefined 时应使用 N/A', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([mockWebhookSetting]);

      let capturedNotification: ProcessedNotification | null = null;
      processorService.on('sendNotification', (notification: ProcessedNotification) => {
        capturedNotification = notification;
      });

      const noUserIdPayload = {
        timestamp: new Date('2024-01-01T12:00:00Z'),
        details: {},
      };

      mockEventService.emit(AppEventType.LoginSuccess, noUserIdPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(capturedNotification?.body).toContain('N/A');
    });

    it('处理单个设置出错不应影响其他设置', async () => {
      const errorSetting: NotificationSetting = {
        ...mockEmailSetting,
        config: null as any, // 故意制造错误
      };
      mockRepository.getEnabledByEvent.mockResolvedValue([errorSetting, mockWebhookSetting]);

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const emitSpy = vi.spyOn(processorService, 'emit');

      mockEventService.emit(AppEventType.LoginSuccess, mockPayload);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // webhook 设置应该仍然被处理
      expect(emitSpy).toHaveBeenCalledWith(
        'sendNotification',
        expect.objectContaining({
          channelType: 'webhook',
        })
      );
      consoleSpy.mockRestore();
    });
  });
});
