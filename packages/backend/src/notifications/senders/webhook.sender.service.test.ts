/**
 * Webhook Sender Service 单元测试
 * 测试 Webhook 消息发送的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import webhookSenderService from './webhook.sender.service';
import type { ProcessedNotification } from '../notification.processor.service';
import type { WebhookConfig } from '../../types/notification.types';

// 使用 vi.hoisted 确保 mock 函数在提升时可用
const { mockAxios, mockIsAxiosError } = vi.hoisted(() => ({
  mockAxios: vi.fn(),
  mockIsAxiosError: vi.fn(),
}));

// Mock axios
vi.mock('axios', () => ({
  default: Object.assign(mockAxios, {
    isAxiosError: mockIsAxiosError,
  }),
  isAxiosError: mockIsAxiosError,
}));

describe('WebhookSenderService', () => {
  const mockWebhookConfig: WebhookConfig = {
    url: 'https://webhook.example.com/notify',
    method: 'POST',
    headers: { 'X-Custom-Header': 'custom-value' },
    bodyTemplate: '{"event": "{event}", "user": "{userId}"}',
  };

  const mockNotification: ProcessedNotification = {
    channelType: 'webhook',
    config: mockWebhookConfig,
    body: '{"event": "LOGIN_SUCCESS", "user": "admin"}',
    rawPayload: { event: 'LOGIN_SUCCESS', userId: 'admin' },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockAxios.mockResolvedValue({ status: 200, data: { success: true } });
    mockIsAxiosError.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('send', () => {
    it('应成功发送 POST 请求', async () => {
      await webhookSenderService.send(mockNotification);

      expect(mockAxios).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://webhook.example.com/notify',
        headers: expect.objectContaining({
          'Content-Type': 'application/json',
          'X-Custom-Header': 'custom-value',
        }),
        data: { event: 'LOGIN_SUCCESS', user: 'admin' },
        params: undefined,
        timeout: 15000,
      });
    });

    it('缺少 URL 时应抛出错误', async () => {
      const configWithoutUrl: WebhookConfig = {
        ...mockWebhookConfig,
        url: '',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutUrl,
      };

      await expect(webhookSenderService.send(invalidNotification)).rejects.toThrow(
        'Webhook configuration is incomplete (missing URL)'
      );

      expect(mockAxios).not.toHaveBeenCalled();
    });

    it('无效的 URL 格式应抛出错误', async () => {
      const configWithInvalidUrl: WebhookConfig = {
        ...mockWebhookConfig,
        url: 'not-a-valid-url',
      };
      const invalidNotification: ProcessedNotification = {
        ...mockNotification,
        config: configWithInvalidUrl,
      };

      await expect(webhookSenderService.send(invalidNotification)).rejects.toThrow(
        'Invalid webhook URL format'
      );

      expect(mockAxios).not.toHaveBeenCalled();
    });
  });

  describe('HTTP 方法', () => {
    it.each(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'] as const)(
      '应支持 %s 方法',
      async (method) => {
        const config: WebhookConfig = {
          ...mockWebhookConfig,
          method,
        };
        const notification: ProcessedNotification = {
          ...mockNotification,
          config,
        };

        await webhookSenderService.send(notification);

        expect(mockAxios).toHaveBeenCalledWith(
          expect.objectContaining({
            method,
          })
        );
      }
    );

    it('应将小写方法转为大写', async () => {
      const config: WebhookConfig = {
        ...mockWebhookConfig,
        method: 'post' as any,
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('未指定方法时应默认使用 POST', async () => {
      const configWithoutMethod: WebhookConfig = {
        url: 'https://webhook.example.com/notify',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutMethod,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          method: 'POST',
        })
      );
    });

    it('无效的 HTTP 方法应抛出错误', async () => {
      const configWithInvalidMethod: WebhookConfig = {
        ...mockWebhookConfig,
        method: 'INVALID' as any,
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithInvalidMethod,
      };

      await expect(webhookSenderService.send(notification)).rejects.toThrow(
        'Invalid HTTP method specified: INVALID'
      );

      expect(mockAxios).not.toHaveBeenCalled();
    });
  });

  describe('请求头', () => {
    it('应设置默认 Content-Type 为 application/json', async () => {
      const configWithoutHeaders: WebhookConfig = {
        url: 'https://webhook.example.com/notify',
        method: 'POST',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithoutHeaders,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('自定义 headers 应与默认 headers 合并', async () => {
      const configWithCustomHeaders: WebhookConfig = {
        ...mockWebhookConfig,
        headers: {
          Authorization: 'Bearer token123',
          'X-Api-Key': 'api-key-456',
        },
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithCustomHeaders,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer token123',
            'X-Api-Key': 'api-key-456',
          },
        })
      );
    });

    it('自定义 Content-Type 应覆盖默认值', async () => {
      const configWithCustomContentType: WebhookConfig = {
        ...mockWebhookConfig,
        headers: {
          'Content-Type': 'application/xml',
        },
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithCustomContentType,
        body: '<event>LOGIN_SUCCESS</event>',
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/xml',
          }),
          data: '<event>LOGIN_SUCCESS</event>', // 非 JSON 应作为原始字符串发送
        })
      );
    });
  });

  describe('请求体处理', () => {
    it('应解析 JSON 格式的请求体', async () => {
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: '{"key": "value", "number": 123}',
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { key: 'value', number: 123 },
        })
      );
    });

    it('无效 JSON 应作为原始字符串发送', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: 'invalid json {',
      };

      await webhookSenderService.send(notification);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse request body as JSON')
      );
      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: 'invalid json {',
        })
      );
      consoleSpy.mockRestore();
    });

    it('GET 请求应记录警告', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const config: WebhookConfig = {
        ...mockWebhookConfig,
        method: 'GET',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config,
      };

      await webhookSenderService.send(notification);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sending data in body for GET request')
      );
      consoleSpy.mockRestore();
    });

    it.each(['POST', 'PUT', 'PATCH'] as const)('%s 请求应在请求体中发送数据', async (method) => {
      const config: WebhookConfig = {
        ...mockWebhookConfig,
        method,
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config,
        body: '{"test": true}',
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { test: true },
        })
      );
    });
  });

  describe('响应状态处理', () => {
    it('2xx 状态码应视为成功', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      for (const status of [200, 201, 202, 204, 299]) {
        mockAxios.mockResolvedValueOnce({ status, data: {} });
        await webhookSenderService.send(mockNotification);
      }

      // 每次发送会调用 2 次 console.log：发送前 + 成功后
      expect(consoleSpy).toHaveBeenCalledTimes(10);
      consoleSpy.mockRestore();
    });

    it('非 2xx 状态码应记录警告但不抛出错误', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      mockAxios.mockResolvedValue({ status: 302, data: { redirected: true } });

      // 不应抛出错误
      await webhookSenderService.send(mockNotification);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('responded with status: 302'),
        expect.any(Object)
      );
      consoleSpy.mockRestore();
    });
  });

  describe('错误处理', () => {
    it('Axios 错误应被正确处理', async () => {
      const axiosError = new Error('Connection refused') as any;
      axiosError.response = {
        status: 500,
        data: { error: 'Internal Server Error' },
      };
      mockAxios.mockRejectedValue(axiosError);
      mockIsAxiosError.mockReturnValue(true);

      await expect(webhookSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send webhook notification (Axios Error): Connection refused'
      );
    });

    it('非 Axios 错误应被正确处理', async () => {
      const unexpectedError = new Error('Unexpected failure');
      mockAxios.mockRejectedValue(unexpectedError);
      mockIsAxiosError.mockReturnValue(false);

      await expect(webhookSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send webhook notification (Unexpected Error): Unexpected failure'
      );
    });

    it('无 message 的错误对象应被处理', async () => {
      const errorWithoutMessage = { code: 'UNKNOWN' };
      mockAxios.mockRejectedValue(errorWithoutMessage);
      mockIsAxiosError.mockReturnValue(false);

      await expect(webhookSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send webhook notification (Unexpected Error)'
      );
    });

    it('超时错误应被正确报告', async () => {
      const timeoutError = new Error('timeout of 15000ms exceeded') as any;
      timeoutError.code = 'ECONNABORTED';
      mockAxios.mockRejectedValue(timeoutError);
      mockIsAxiosError.mockReturnValue(true);

      await expect(webhookSenderService.send(mockNotification)).rejects.toThrow(
        'Failed to send webhook notification (Axios Error): timeout of 15000ms exceeded'
      );
    });
  });

  describe('边界条件', () => {
    it('应处理空的请求体', async () => {
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: '',
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalled();
    });

    it('应处理复杂的嵌套 JSON', async () => {
      const complexBody = JSON.stringify({
        level1: {
          level2: {
            level3: {
              array: [1, 2, 3],
              boolean: true,
              null: null,
            },
          },
        },
      });
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: complexBody,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: JSON.parse(complexBody),
        })
      );
    });

    it('应使用 15 秒超时', async () => {
      await webhookSenderService.send(mockNotification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 15000,
        })
      );
    });

    it('应处理带端口的 URL', async () => {
      const configWithPort: WebhookConfig = {
        ...mockWebhookConfig,
        url: 'https://webhook.example.com:8443/notify',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithPort,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://webhook.example.com:8443/notify',
        })
      );
    });

    it('应处理带查询参数的 URL', async () => {
      const configWithQuery: WebhookConfig = {
        ...mockWebhookConfig,
        url: 'https://webhook.example.com/notify?token=abc&version=1',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithQuery,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'https://webhook.example.com/notify?token=abc&version=1',
        })
      );
    });

    it('应处理 HTTP 协议的 URL', async () => {
      const configWithHttp: WebhookConfig = {
        ...mockWebhookConfig,
        url: 'http://internal-service.local/webhook',
      };
      const notification: ProcessedNotification = {
        ...mockNotification,
        config: configWithHttp,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          url: 'http://internal-service.local/webhook',
        })
      );
    });

    it('应处理包含特殊字符的请求体', async () => {
      const bodyWithSpecialChars = JSON.stringify({
        message: 'Test with "quotes" and <html> & entities',
        unicode: '中文 日本語 한국어 emoji: 🎉',
      });
      const notification: ProcessedNotification = {
        ...mockNotification,
        body: bodyWithSpecialChars,
      };

      await webhookSenderService.send(notification);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: JSON.parse(bodyWithSpecialChars),
        })
      );
    });
  });

  describe('日志记录', () => {
    it('发送前应记录请求信息', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      await webhookSenderService.send(mockNotification);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Sending POST notification to webhook URL')
      );
      consoleSpy.mockRestore();
    });

    it('成功后应记录状态码', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      mockAxios.mockResolvedValue({ status: 201, data: { created: true } });

      await webhookSenderService.send(mockNotification);

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Status: 201'));
      consoleSpy.mockRestore();
    });

    it('失败时应记录错误信息', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const axiosError = new Error('Network Error') as any;
      axiosError.response = { status: 503, data: { error: 'Service Unavailable' } };
      mockAxios.mockRejectedValue(axiosError);
      mockIsAxiosError.mockReturnValue(true);

      await expect(webhookSenderService.send(mockNotification)).rejects.toThrow();

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Axios error sending notification'),
        expect.any(Number),
        expect.any(Object)
      );
      consoleSpy.mockRestore();
    });
  });
});
