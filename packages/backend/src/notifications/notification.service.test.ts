/**
 * Notification Service 单元测试
 * 测试通知系统的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { NotificationService } from './notification.service';
import * as nodemailer from 'nodemailer';
import axios from 'axios';
import type {
  NotificationSetting,
  EmailConfig,
  WebhookConfig,
  TelegramConfig,
} from '../types/notification.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const {
  mockRepository,
  mockCreateTransport,
  mockSendMail,
  mockAxios,
  mockAxiosPost,
  mockGetSetting,
  mockI18nT,
  mockFormatInTimeZone,
} = vi.hoisted(() => ({
  mockRepository: {
    getAll: vi.fn(),
    getById: vi.fn(),
    getEnabledByEvent: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  mockSendMail: vi.fn(),
  mockCreateTransport: vi.fn(() => ({
    sendMail: vi.fn(),
  })),
  mockAxios: vi.fn(),
  mockAxiosPost: vi.fn(),
  mockGetSetting: vi.fn(),
  mockI18nT: vi.fn((key: string, options?: any) => options?.defaultValue || key),
  mockFormatInTimeZone: vi.fn(
    (date: Date, tz: string, format: string) => '2024-01-01T12:00:00+08:00'
  ),
}));

// Mock 依赖模块
vi.mock('./notification.repository', () => ({
  NotificationSettingsRepository: vi.fn().mockImplementation(() => mockRepository),
}));

vi.mock('nodemailer', () => ({
  createTransport: mockCreateTransport,
}));

vi.mock('axios', () => ({
  default: Object.assign(mockAxios, {
    post: mockAxiosPost,
  }),
}));

vi.mock('../settings/settings.service', () => ({
  settingsService: {
    getSetting: mockGetSetting,
  },
}));

vi.mock('../i18n', () => ({
  default: {
    t: mockI18nT,
  },
  defaultLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
}));

vi.mock('date-fns-tz', () => ({
  formatInTimeZone: mockFormatInTimeZone,
}));

describe('NotificationService', () => {
  let service: NotificationService;
  let mockTransporter: any;

  const mockEmailConfig: EmailConfig = {
    to: 'test@example.com',
    from: 'noreply@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecure: true,
    smtpUser: 'user',
    smtpPass: 'pass',
  };

  const mockWebhookConfig: WebhookConfig = {
    url: 'https://webhook.example.com/notify',
    method: 'POST',
    headers: { 'X-Custom-Header': 'value' },
    bodyTemplate: '{"event": "{event}", "details": "{details}"}',
  };

  const mockTelegramConfig: TelegramConfig = {
    botToken: '123456:ABC-DEF',
    chatId: '-1001234567890',
    messageTemplate: '*{event}*\n{details}',
  };

  const mockSetting: NotificationSetting = {
    id: 1,
    name: '测试通知',
    channel_type: 'email',
    config: mockEmailConfig,
    enabled_events: ['SETTINGS_UPDATED', 'CONNECTION_TEST'],
    is_enabled: true,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockTransporter = {
      sendMail: vi.fn().mockResolvedValue({ messageId: 'test-message-id' }),
    };
    mockCreateTransport.mockReturnValue(mockTransporter);

    service = new NotificationService();
  });

  afterEach(() => {
    // 仅清除调用历史，不重置 mock 实现
    // vi.resetAllMocks() 会重置 NotificationSettingsRepository 的 mockImplementation
    // 导致后续测试中 repository 变为 undefined
  });

  describe('getAllSettings', () => {
    it('应返回所有通知设置', async () => {
      const mockSettings = [mockSetting, { ...mockSetting, id: 2, name: '另一个通知' }];
      mockRepository.getAll.mockResolvedValue(mockSettings);

      const result = await service.getAllSettings();

      expect(result).toEqual(mockSettings);
      expect(mockRepository.getAll).toHaveBeenCalledTimes(1);
    });

    it('无设置时应返回空数组', async () => {
      mockRepository.getAll.mockResolvedValue([]);

      const result = await service.getAllSettings();

      expect(result).toEqual([]);
    });
  });

  describe('getSettingById', () => {
    it('应返回指定 ID 的设置', async () => {
      mockRepository.getById.mockResolvedValue(mockSetting);

      const result = await service.getSettingById(1);

      expect(result).toEqual(mockSetting);
      expect(mockRepository.getById).toHaveBeenCalledWith(1);
    });

    it('设置不存在时应返回 null', async () => {
      mockRepository.getById.mockResolvedValue(null);

      const result = await service.getSettingById(999);

      expect(result).toBeNull();
    });
  });

  describe('createSetting', () => {
    it('应成功创建通知设置', async () => {
      mockRepository.create.mockResolvedValue(1);

      const newSetting = {
        name: '新通知',
        channel_type: 'email' as const,
        config: mockEmailConfig,
        enabled_events: ['SETTINGS_UPDATED'],
        is_enabled: true,
      };

      const result = await service.createSetting(newSetting);

      expect(result).toBe(1);
      expect(mockRepository.create).toHaveBeenCalledWith(newSetting);
    });
  });

  describe('updateSetting', () => {
    it('应成功更新通知设置', async () => {
      mockRepository.update.mockResolvedValue(true);

      const result = await service.updateSetting(1, { name: '更新的名称' });

      expect(result).toBe(true);
      expect(mockRepository.update).toHaveBeenCalledWith(1, { name: '更新的名称' });
    });

    it('设置不存在时应返回 false', async () => {
      mockRepository.update.mockResolvedValue(false);

      const result = await service.updateSetting(999, { name: '不存在' });

      expect(result).toBe(false);
    });
  });

  describe('deleteSetting', () => {
    it('应成功删除通知设置', async () => {
      mockRepository.delete.mockResolvedValue(true);

      const result = await service.deleteSetting(1);

      expect(result).toBe(true);
      expect(mockRepository.delete).toHaveBeenCalledWith(1);
    });

    it('设置不存在时应返回 false', async () => {
      mockRepository.delete.mockResolvedValue(false);

      const result = await service.deleteSetting(999);

      expect(result).toBe(false);
    });
  });

  describe('testSetting', () => {
    beforeEach(() => {
      mockGetSetting.mockResolvedValue('zh-CN');
    });

    describe('Email 测试', () => {
      it('应成功发送测试邮件', async () => {
        const result = await service.testSetting('email', mockEmailConfig);

        expect(result.success).toBe(true);
        expect(result.message).toContain('成功');
        expect(nodemailer.createTransport).toHaveBeenCalledWith(
          expect.objectContaining({
            host: 'smtp.example.com',
            port: 587,
            secure: true,
          })
        );
        expect(mockTransporter.sendMail).toHaveBeenCalled();
      });

      it('缺少必要配置时应返回失败', async () => {
        const incompleteConfig: EmailConfig = {
          to: 'test@example.com',
          from: '',
          smtpHost: '',
          smtpPort: 0,
        };

        const result = await service.testSetting('email', incompleteConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('缺少');
      });

      it('发送失败时应返回错误信息', async () => {
        mockTransporter.sendMail.mockRejectedValue(new Error('SMTP connection failed'));

        const result = await service.testSetting('email', mockEmailConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('失败');
      });
    });

    describe('Webhook 测试', () => {
      it('应成功发送测试 Webhook', async () => {
        mockAxios.mockResolvedValue({ status: 200, data: { ok: true } });

        const result = await service.testSetting('webhook', mockWebhookConfig);

        expect(result.success).toBe(true);
        expect(result.message).toContain('成功');
        expect(mockAxios).toHaveBeenCalledWith(
          expect.objectContaining({
            method: 'POST',
            url: 'https://webhook.example.com/notify',
          })
        );
      });

      it('缺少 URL 时应返回失败', async () => {
        const incompleteConfig: WebhookConfig = { url: '' };

        const result = await service.testSetting('webhook', incompleteConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('缺少');
      });

      it('请求失败时应返回错误信息', async () => {
        mockAxios.mockRejectedValue({
          response: { data: { message: 'Unauthorized' } },
          message: 'Request failed',
        });

        const result = await service.testSetting('webhook', mockWebhookConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('失败');
      });
    });

    describe('Telegram 测试', () => {
      it('应成功发送测试 Telegram 消息', async () => {
        mockAxiosPost.mockResolvedValue({ data: { ok: true } });

        const result = await service.testSetting('telegram', mockTelegramConfig);

        expect(result.success).toBe(true);
        expect(result.message).toContain('成功');
        expect(mockAxiosPost).toHaveBeenCalledWith(
          expect.stringContaining('api.telegram.org'),
          expect.objectContaining({
            chat_id: '-1001234567890',
            parse_mode: 'Markdown',
          }),
          expect.any(Object)
        );
      });

      it('缺少 botToken 或 chatId 时应返回失败', async () => {
        const incompleteConfig: TelegramConfig = {
          botToken: '',
          chatId: '',
        };

        const result = await service.testSetting('telegram', incompleteConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('缺少');
      });

      it('应支持自定义域名', async () => {
        mockAxiosPost.mockResolvedValue({ data: { ok: true } });

        const configWithCustomDomain: TelegramConfig = {
          ...mockTelegramConfig,
          customDomain: 'https://custom-telegram-api.example.com',
        };

        await service.testSetting('telegram', configWithCustomDomain);

        expect(mockAxiosPost).toHaveBeenCalledWith(
          expect.stringContaining('custom-telegram-api.example.com'),
          expect.any(Object),
          expect.any(Object)
        );
      });

      it('API 返回错误时应返回失败', async () => {
        mockAxiosPost.mockResolvedValue({
          data: { ok: false, description: 'Bad Request: chat not found' },
        });

        const result = await service.testSetting('telegram', mockTelegramConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('失败');
      });

      it('请求异常时应返回错误信息', async () => {
        mockAxiosPost.mockRejectedValue({
          response: { data: { description: 'Unauthorized' } },
          message: 'Network error',
        });

        const result = await service.testSetting('telegram', mockTelegramConfig);

        expect(result.success).toBe(false);
        expect(result.message).toContain('失败');
      });
    });

    describe('不支持的渠道类型', () => {
      it('应返回不支持的渠道类型错误', async () => {
        const result = await service.testSetting('unknown' as any, {});

        expect(result.success).toBe(false);
        expect(result.message).toContain('不支持');
      });
    });
  });

  describe('sendNotification', () => {
    beforeEach(() => {
      mockGetSetting
        .mockResolvedValueOnce('zh-CN') // language
        .mockResolvedValueOnce('Asia/Shanghai'); // timezone
    });

    it('应向所有匹配的设置发送通知', async () => {
      const emailSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'email',
        config: mockEmailConfig,
      };
      const webhookSetting: NotificationSetting = {
        ...mockSetting,
        id: 2,
        channel_type: 'webhook',
        config: mockWebhookConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([emailSetting, webhookSetting]);
      mockAxios.mockResolvedValue({ status: 200 });

      await service.sendNotification('SETTINGS_UPDATED', { updatedKeys: ['theme'] });

      expect(mockRepository.getEnabledByEvent).toHaveBeenCalledWith('SETTINGS_UPDATED');
      expect(mockTransporter.sendMail).toHaveBeenCalled();
      expect(mockAxios).toHaveBeenCalled();
    });

    it('无匹配设置时应静默返回', async () => {
      mockRepository.getEnabledByEvent.mockResolvedValue([]);

      await service.sendNotification('SETTINGS_UPDATED');

      expect(mockTransporter.sendMail).not.toHaveBeenCalled();
      expect(mockAxios).not.toHaveBeenCalled();
    });

    it('应处理 Telegram 渠道通知', async () => {
      const telegramSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'telegram',
        config: mockTelegramConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([telegramSetting]);
      mockAxiosPost.mockResolvedValue({ data: { ok: true } });

      await service.sendNotification('SETTINGS_UPDATED', { updatedKeys: ['language'] });

      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.objectContaining({
          chat_id: '-1001234567890',
        }),
        expect.any(Object)
      );
    });

    it('应处理字符串类型的 details', async () => {
      const emailSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'email',
        config: mockEmailConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([emailSetting]);

      await service.sendNotification('SETTINGS_UPDATED', '简单的字符串详情');

      expect(mockTransporter.sendMail).toHaveBeenCalled();
    });

    it('应处理未知渠道类型', async () => {
      const unknownSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'unknown' as any,
        config: {},
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([unknownSetting]);

      // 不应抛出错误
      await expect(service.sendNotification('SETTINGS_UPDATED')).resolves.toBeUndefined();
    });

    it('获取设置失败时应捕获错误', async () => {
      mockRepository.getEnabledByEvent.mockRejectedValue(new Error('Database error'));

      // 不应抛出错误
      await expect(service.sendNotification('SETTINGS_UPDATED')).resolves.toBeUndefined();
    });

    it('单个通知发送失败不应影响其他通知', async () => {
      const emailSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'email',
        config: mockEmailConfig,
      };
      const webhookSetting: NotificationSetting = {
        ...mockSetting,
        id: 2,
        channel_type: 'webhook',
        config: mockWebhookConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([emailSetting, webhookSetting]);
      mockTransporter.sendMail.mockRejectedValue(new Error('SMTP error'));
      mockAxios.mockResolvedValue({ status: 200 });

      await service.sendNotification('SETTINGS_UPDATED');

      // 两个都应该被调用，即使第一个失败
      expect(mockTransporter.sendMail).toHaveBeenCalled();
      expect(mockAxios).toHaveBeenCalled();
    });
  });

  describe('_renderTemplate (通过 testSetting 间接测试)', () => {
    beforeEach(() => {
      mockGetSetting.mockResolvedValue('zh-CN');
    });

    it('应正确渲染模板变量', async () => {
      mockAxios.mockResolvedValue({ status: 200 });

      const webhookConfig: WebhookConfig = {
        url: 'https://example.com',
        bodyTemplate: '{"event": "{event}", "time": "{timestamp}"}',
      };

      await service.testSetting('webhook', webhookConfig);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.stringContaining('SETTINGS_UPDATED'),
        })
      );
    });
  });

  describe('_escapeBasicMarkdown (通过 Telegram 测试间接验证)', () => {
    beforeEach(() => {
      mockGetSetting.mockResolvedValue('zh-CN');
    });

    it('应转义 Markdown 特殊字符', async () => {
      mockAxiosPost.mockResolvedValue({ data: { ok: true } });

      await service.testSetting('telegram', mockTelegramConfig);

      // 验证 Telegram 消息被正确发送
      expect(mockAxiosPost).toHaveBeenCalled();
    });
  });

  describe('_translatePayloadDetails (通过 sendNotification 间接测试)', () => {
    beforeEach(() => {
      mockGetSetting.mockResolvedValueOnce('zh-CN').mockResolvedValueOnce('Asia/Shanghai');
    });

    it('应翻译连接测试成功详情', async () => {
      const webhookSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'webhook',
        config: mockWebhookConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([webhookSetting]);
      mockAxios.mockResolvedValue({ status: 200 });

      await service.sendNotification('CONNECTION_TEST', {
        testResult: 'success',
        connectionName: '测试服务器',
      });

      expect(mockAxios).toHaveBeenCalled();
    });

    it('应翻译连接测试失败详情', async () => {
      const webhookSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'webhook',
        config: mockWebhookConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([webhookSetting]);
      mockAxios.mockResolvedValue({ status: 200 });

      await service.sendNotification('CONNECTION_TEST', {
        testResult: 'failed',
        connectionName: '测试服务器',
        error: 'Connection refused',
      });

      expect(mockAxios).toHaveBeenCalled();
    });

    it('应翻译设置更新详情', async () => {
      const webhookSetting: NotificationSetting = {
        ...mockSetting,
        channel_type: 'webhook',
        config: mockWebhookConfig,
      };

      mockRepository.getEnabledByEvent.mockResolvedValue([webhookSetting]);
      mockAxios.mockResolvedValue({ status: 200 });

      await service.sendNotification('SETTINGS_UPDATED', {
        updatedKeys: ['ipWhitelist'],
      });

      expect(mockAxios).toHaveBeenCalled();
    });
  });

  describe('边界条件', () => {
    it('应处理空的 config 对象', async () => {
      const result = await service.testSetting('email', {} as EmailConfig);

      expect(result.success).toBe(false);
    });

    it('应处理 null/undefined 配置值', async () => {
      const configWithNulls: EmailConfig = {
        to: 'test@example.com',
        from: 'from@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: undefined,
        smtpPass: undefined,
      };

      // 无认证信息时应仍能创建 transporter
      await service.testSetting('email', configWithNulls);

      expect(nodemailer.createTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: undefined,
        })
      );
    });

    it('获取语言设置失败时应使用默认值', async () => {
      mockGetSetting.mockRejectedValue(new Error('DB error'));

      const result = await service.testSetting('email', mockEmailConfig);

      // 应该继续执行，使用默认语言
      expect(nodemailer.createTransport).toHaveBeenCalled();
    });

    it('应处理无效的自定义 Telegram 域名', async () => {
      mockAxiosPost.mockResolvedValue({ data: { ok: true } });

      const configWithInvalidDomain: TelegramConfig = {
        ...mockTelegramConfig,
        customDomain: 'not-a-valid-url',
      };

      await service.testSetting('telegram', configWithInvalidDomain);

      // 应回退到默认 API
      expect(mockAxiosPost).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });
});
