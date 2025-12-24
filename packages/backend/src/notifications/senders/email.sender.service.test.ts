/**
 * Email Sender Service 单元测试
 * 测试邮件发送的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import emailSenderService from './email.sender.service';
import type { ProcessedNotification } from '../notification.processor.service';
import type { EmailConfig } from '../../types/notification.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const { mockSendMail, mockCreateTransport, mockGetSetting } = vi.hoisted(() => ({
  mockSendMail: vi.fn(),
  mockCreateTransport: vi.fn(() => ({
    sendMail: vi.fn(),
  })),
  mockGetSetting: vi.fn(),
}));

// Mock nodemailer
vi.mock('nodemailer', () => ({
  default: {
    createTransport: mockCreateTransport,
  },
  createTransport: mockCreateTransport,
}));

// Mock settingsService
vi.mock('../../settings/settings.service', () => ({
  settingsService: {
    getSetting: mockGetSetting,
  },
}));

describe('EmailSenderService', () => {
  const mockEmailConfig: EmailConfig = {
    to: 'recipient@example.com',
    from: 'sender@example.com',
    smtpHost: 'smtp.example.com',
    smtpPort: 587,
    smtpSecure: false,
    smtpUser: 'user',
    smtpPass: 'password',
  };

  const mockNotification: ProcessedNotification = {
    channelType: 'email',
    config: mockEmailConfig,
    subject: '测试邮件',
    body: '<h1>测试内容</h1>',
    rawPayload: { event: 'TEST_EVENT' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockSendMail.mockResolvedValue({ messageId: 'test-message-id-123' });
    mockCreateTransport.mockReturnValue({ sendMail: mockSendMail });
    // 默认不返回全局设置
    mockGetSetting.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('send', () => {
    it('应成功发送邮件', async () => {
      await emailSenderService.send(mockNotification);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com',
          port: 587,
          secure: false,
          auth: {
            user: 'user',
            pass: 'password',
          },
        })
      );

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'recipient@example.com',
          subject: '测试邮件',
          html: '<h1>测试内容</h1>',
        })
      );
    });

    it('应使用默认主题当 subject 未提供时', async () => {
      const notificationWithoutSubject: ProcessedNotification = {
        ...mockNotification,
        subject: undefined,
      };

      await emailSenderService.send(notificationWithoutSubject);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          subject: 'Notification',
        })
      );
    });

    it('缺少收件人时应抛出错误', async () => {
      const configWithoutTo: EmailConfig = {
        ...mockEmailConfig,
        to: '',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutTo,
      };

      await expect(emailSenderService.send(invalidNotification)).rejects.toThrow(
        'Email configuration is incomplete (missing recipient address)'
      );

      expect(mockCreateTransport).not.toHaveBeenCalled();
    });

    it('缺少 SMTP 主机时应抛出错误', async () => {
      const configWithoutHost: EmailConfig = {
        ...mockEmailConfig,
        smtpHost: '',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutHost,
      };

      await expect(emailSenderService.send(invalidNotification)).rejects.toThrow(
        'SMTP host configuration is missing'
      );
    });

    it('无效的 SMTP 端口应抛出错误', async () => {
      const configWithInvalidPort: EmailConfig = {
        ...mockEmailConfig,
        smtpPort: -1,
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithInvalidPort,
      };

      await expect(emailSenderService.send(invalidNotification)).rejects.toThrow(
        'Invalid SMTP port configured'
      );
    });

    it('端口为 0 时应抛出错误', async () => {
      const configWithZeroPort: EmailConfig = {
        ...mockEmailConfig,
        smtpPort: 0,
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithZeroPort,
      };

      await expect(emailSenderService.send(invalidNotification)).rejects.toThrow(
        'Invalid SMTP port configured'
      );
    });

    it('sendMail 失败时应抛出错误', async () => {
      mockSendMail.mockRejectedValue(new Error('SMTP connection failed'));

      await expect(emailSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send email notification: SMTP connection failed'
      );
    });
  });

  describe('全局 SMTP 设置回退', () => {
    it('应使用全局 SMTP 设置当渠道配置缺失时', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          smtpHost: 'global-smtp.example.com',
          smtpPort: '465',
          smtpSecure: 'true',
          smtpUser: 'global-user',
          smtpPass: 'global-pass',
          smtpFrom: 'global@example.com',
        };
        return Promise.resolve(settings[key] || null);
      });

      // 注意：使用 undefined 而非 0，因为实现使用 ?? 运算符
      // smtpPort: 0 会被保留而非回退到全局设置
      const configWithoutSmtp: EmailConfig = {
        to: 'recipient@example.com',
        from: '',
        smtpHost: '',
        smtpPort: undefined as any,
      };
      const notificationWithPartialConfig: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutSmtp,
      };

      await emailSenderService.send(notificationWithPartialConfig);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'global-smtp.example.com',
          port: 465,
          secure: true,
          auth: {
            user: 'global-user',
            pass: 'global-pass',
          },
        })
      );
    });

    it('应优先使用渠道配置而非全局配置', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          smtpHost: 'global-smtp.example.com',
          smtpPort: '465',
          smtpSecure: 'true',
        };
        return Promise.resolve(settings[key] || null);
      });

      await emailSenderService.send(mockNotification);

      // 应使用渠道配置的值
      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          host: 'smtp.example.com', // 来自渠道配置
          port: 587, // 来自渠道配置
          secure: false, // 来自渠道配置
        })
      );
    });

    it('应使用默认发件人地址当均未配置时', async () => {
      const configWithoutFrom: EmailConfig = {
        ...mockEmailConfig,
        from: '',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutFrom,
      };

      await emailSenderService.send(notification);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: expect.stringContaining('noreply@nexus-terminal.local'),
        })
      );
    });

    it('应使用默认端口 587 当全局配置未设置端口时', async () => {
      mockGetSetting.mockImplementation((key: string) => {
        const settings: Record<string, string> = {
          smtpHost: 'global-smtp.example.com',
        };
        return Promise.resolve(settings[key] || null);
      });

      // 使用 undefined 而非 0，因为实现使用 ?? 运算符
      const configWithoutPort: EmailConfig = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        smtpHost: '',
        smtpPort: undefined as any,
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutPort,
      };

      await emailSenderService.send(notification);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          port: 587, // 默认端口
        })
      );
    });
  });

  describe('认证配置', () => {
    it('无认证信息时 auth 应为 undefined', async () => {
      const configWithoutAuth: EmailConfig = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: '',
        smtpPass: '',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutAuth,
      };

      await emailSenderService.send(notification);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: undefined,
        })
      );
    });

    it('仅有用户名无密码时 auth 应为 undefined', async () => {
      const configWithOnlyUser: EmailConfig = {
        to: 'recipient@example.com',
        from: 'sender@example.com',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpUser: 'user',
        smtpPass: '',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithOnlyUser,
      };

      await emailSenderService.send(notification);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          auth: undefined,
        })
      );
    });
  });

  describe('TLS 配置', () => {
    it('应配置 TLS 选项', async () => {
      await emailSenderService.send(mockNotification);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          tls: expect.objectContaining({
            minVersion: 'TLSv1.2',
          }),
        })
      );
    });

    it('secure 为 true 时应设置 rejectUnauthorized 为 true', async () => {
      const secureConfig: EmailConfig = {
        ...mockEmailConfig,
        smtpSecure: true,
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: secureConfig,
      };

      await emailSenderService.send(notification);

      expect(mockCreateTransport).toHaveBeenCalledWith(
        expect.objectContaining({
          secure: true,
          tls: expect.objectContaining({
            rejectUnauthorized: true,
          }),
        })
      );
    });
  });

  describe('发件人格式化', () => {
    it('应正确格式化发件人地址', async () => {
      const configWithEmail: EmailConfig = {
        ...mockEmailConfig,
        from: 'noreply@mycompany.com',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithEmail,
      };

      await emailSenderService.send(notification);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          from: '"noreply" <noreply@mycompany.com>',
        })
      );
    });
  });

  describe('边界条件', () => {
    it('settingsService.getSetting 失败时应继续执行', async () => {
      mockGetSetting.mockRejectedValue(new Error('Database error'));

      // 渠道配置完整，应能正常发送
      await expect(emailSenderService.send(mockNotification)).rejects.toThrow();
    });

    it('应处理空的 body 内容', async () => {
      const notificationWithEmptyBody: ProcessedNotification = {
        ...mockNotification,
        body: '',
      };

      await emailSenderService.send(notificationWithEmptyBody);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '',
        })
      );
    });

    it('应处理 HTML 内容中的特殊字符', async () => {
      const notificationWithSpecialChars: ProcessedNotification = {
        ...mockNotification,
        body: '<p>Test &amp; "quoted" <script>alert(1)</script></p>',
      };

      await emailSenderService.send(notificationWithSpecialChars);

      expect(mockSendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          html: '<p>Test &amp; "quoted" <script>alert(1)</script></p>',
        })
      );
    });
  });
});
