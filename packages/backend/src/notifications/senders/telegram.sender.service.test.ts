/**
 * Telegram Sender Service 单元测试
 * 测试 Telegram 消息发送的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import telegramSenderService from './telegram.sender.service';
import type { ProcessedNotification } from '../notification.processor.service';
import type { TelegramConfig } from '../../types/notification.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const { mockPost, mockIsAxiosError } = vi.hoisted(() => ({
  mockPost: vi.fn(),
  mockIsAxiosError: vi.fn(),
}));

// Mock axios
vi.mock('axios', () => ({
  default: {
    post: mockPost,
    isAxiosError: mockIsAxiosError,
  },
  post: mockPost,
  isAxiosError: mockIsAxiosError,
}));

describe('TelegramSenderService', () => {
  const mockTelegramConfig: TelegramConfig = {
    botToken: '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ',
    chatId: '-1001234567890',
    messageTemplate: '*{event}*\n详情: {details}',
  };

  const mockNotification: ProcessedNotification = {
    channelType: 'telegram',
    config: mockTelegramConfig,
    subject: '测试通知',
    body: '*登录成功*\n用户: admin\n时间: 2024-01-01 12:00:00',
    rawPayload: { event: 'LOGIN_SUCCESS' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockPost.mockResolvedValue({
      data: { ok: true, result: { message_id: 123 } },
    });
    mockIsAxiosError.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('send', () => {
    it('应成功发送 Telegram 消息', async () => {
      await telegramSenderService.send(mockNotification);

      expect(mockPost).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123456789:ABCdefGHIjklMNOpqrSTUvwxYZ/sendMessage',
        {
          chat_id: '-1001234567890',
          text: mockNotification.body,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        },
        { timeout: 10000 }
      );
    });

    it('缺少 botToken 时应抛出错误', async () => {
      const configWithoutToken: TelegramConfig = {
        ...mockTelegramConfig,
        botToken: '',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutToken,
      };

      await expect(telegramSenderService.send(invalidNotification)).rejects.toThrow(
        'Telegram configuration is incomplete (missing botToken or chatId)'
      );

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('缺少 chatId 时应抛出错误', async () => {
      const configWithoutChatId: TelegramConfig = {
        ...mockTelegramConfig,
        chatId: '',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutChatId,
      };

      await expect(telegramSenderService.send(invalidNotification)).rejects.toThrow(
        'Telegram configuration is incomplete (missing botToken or chatId)'
      );

      expect(mockPost).not.toHaveBeenCalled();
    });

    it('botToken 和 chatId 同时缺失时应抛出错误', async () => {
      const emptyConfig: TelegramConfig = {
        botToken: '',
        chatId: '',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: emptyConfig,
      };

      await expect(telegramSenderService.send(invalidNotification)).rejects.toThrow(
        'Telegram configuration is incomplete'
      );
    });
  });

  describe('自定义域名', () => {
    it('应支持自定义 Telegram API 域名', async () => {
      const configWithCustomDomain: TelegramConfig = {
        ...mockTelegramConfig,
        customDomain: 'https://my-telegram-proxy.example.com',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithCustomDomain,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('my-telegram-proxy.example.com'),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('无效的自定义域名应回退到默认 API', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const configWithInvalidDomain: TelegramConfig = {
        ...mockTelegramConfig,
        customDomain: 'not-a-valid-url',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithInvalidDomain,
      };

      await telegramSenderService.send(notification);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid customDomain URL'));
      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.any(Object),
        expect.any(Object)
      );
      consoleSpy.mockRestore();
    });

    it('自定义域名应保留协议和主机', async () => {
      const configWithHttpsDomain: TelegramConfig = {
        ...mockTelegramConfig,
        customDomain: 'https://proxy.example.com:8443/path',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithHttpsDomain,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringMatching(/^https:\/\/proxy\.example\.com:8443\/bot/),
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('空的自定义域名应使用默认 API', async () => {
      const configWithEmptyDomain: TelegramConfig = {
        ...mockTelegramConfig,
        customDomain: '',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithEmptyDomain,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.stringContaining('api.telegram.org'),
        expect.any(Object),
        expect.any(Object)
      );
    });
  });

  describe('API 响应处理', () => {
    it('API 返回 ok: false 时应抛出错误', async () => {
      mockPost.mockResolvedValue({
        data: { ok: false, description: 'Bad Request: chat not found' },
      });

      await expect(telegramSenderService.send(mockNotification)).rejects.toThrow(
        'Telegram API error: Bad Request: chat not found'
      );
    });

    it('API 返回未知错误时应抛出通用错误', async () => {
      mockPost.mockResolvedValue({
        data: { ok: false },
      });

      await expect(telegramSenderService.send(mockNotification)).rejects.toThrow(
        'Telegram API error: Unknown error from Telegram API'
      );
    });

    it('应正确处理成功响应', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockPost.mockResolvedValue({
        data: { ok: true, result: { message_id: 456 } },
      });

      await telegramSenderService.send(mockNotification);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Successfully sent notification')
      );
      consoleSpy.mockRestore();
    });
  });

  describe('错误处理', () => {
    it('Axios 错误应被正确处理', async () => {
      const axiosError = new Error('Network Error') as any;
      axiosError.response = {
        data: { description: 'Connection timeout' },
      };
      mockPost.mockRejectedValue(axiosError);
      mockIsAxiosError.mockReturnValue(true);

      await expect(telegramSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send Telegram notification (Axios Error): Network Error'
      );
    });

    it('非 Axios 错误应被正确处理', async () => {
      const unexpectedError = new Error('Unexpected failure');
      mockPost.mockRejectedValue(unexpectedError);
      mockIsAxiosError.mockReturnValue(false);

      await expect(telegramSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send Telegram notification (Unexpected Error): Unexpected failure'
      );
    });

    it('无 message 的错误对象应被处理', async () => {
      const errorWithoutMessage = { code: 'UNKNOWN' };
      mockPost.mockRejectedValue(errorWithoutMessage);
      mockIsAxiosError.mockReturnValue(false);

      await expect(telegramSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send Telegram notification (Unexpected Error)'
      );
    });
  });

  describe('消息格式', () => {
    it('应发送 Markdown 格式消息', async () => {
      await telegramSenderService.send(mockNotification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          parse_mode: 'Markdown',
        }),
        expect.any(Object)
      );
    });

    it('应禁用网页预览', async () => {
      await telegramSenderService.send(mockNotification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          disable_web_page_preview: true,
        }),
        expect.any(Object)
      );
    });

    it('应正确传递消息体', async () => {
      const customBody = '*自定义消息*\n- 项目1\n- 项目2';
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: customBody,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: customBody,
        }),
        expect.any(Object)
      );
    });
  });

  describe('边界条件', () => {
    it('应处理空的消息体', async () => {
      const notificationWithEmptyBody: ProcessedNotification = {
        ...mockNotification,
        body: '',
      };

      await telegramSenderService.send(notificationWithEmptyBody);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: '',
        }),
        expect.any(Object)
      );
    });

    it('应处理超长消息', async () => {
      const longBody = 'A'.repeat(5000);
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: longBody,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: longBody,
        }),
        expect.any(Object)
      );
    });

    it('应处理包含特殊 Markdown 字符的消息', async () => {
      const bodyWithSpecialChars = '*bold* _italic_ `code` [link](url)';
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: bodyWithSpecialChars,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          text: bodyWithSpecialChars,
        }),
        expect.any(Object)
      );
    });

    it('应使用 10 秒超时', async () => {
      await telegramSenderService.send(mockNotification);

      expect(mockPost).toHaveBeenCalledWith(expect.any(String), expect.any(Object), {
        timeout: 10000,
      });
    });

    it('应处理数字类型的 chatId', async () => {
      const configWithNumberChatId: TelegramConfig = {
        ...mockTelegramConfig,
        chatId: '123456789',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithNumberChatId,
      };

      await telegramSenderService.send(notification);

      expect(mockPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          chat_id: '123456789',
        }),
        expect.any(Object)
      );
    });
  });
});
