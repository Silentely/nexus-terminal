/**
 * Pollinations Service 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Repository
vi.mock('./pollinations.repository', () => ({
  getUserSettings: vi.fn(),
  saveSettings: vi.fn(),
  updateUserKey: vi.fn(),
  clearUserKey: vi.fn(),
  isPollinationsEnabled: vi.fn(),
}));

// Mock fetch 全局函数
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('Pollinations Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('startWebAuth', () => {
    it('应保存配置并返回授权 URL', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { startWebAuth } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.saveSettings).mockResolvedValue(undefined);

      const result = await startWebAuth(1, {
        app_key: 'pk_test123',
        redirect_uri: 'https://example.com/callback',
        scope: 'usage,keys',
        models: ['openai', 'claude'],
        budget: 10,
        expiry: 86400,
      });

      expect(result.authorization_url).toContain('enter.pollinations.ai/authorize');
      expect(result.authorization_url).toContain('pk_test123');
      expect(PollinationsRepository.saveSettings).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          app_key: 'pk_test123',
          enabled: false,
        })
      );
    });
  });

  describe('handleCallback', () => {
    it('应保存 User Key 并启用 Pollinations', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { handleCallback } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.updateUserKey).mockResolvedValue(undefined);
      vi.mocked(PollinationsRepository.saveSettings).mockResolvedValue(undefined);

      await handleCallback(1, 'sk_callback_token');

      expect(PollinationsRepository.updateUserKey).toHaveBeenCalledWith(1, 'sk_callback_token');
      expect(PollinationsRepository.saveSettings).toHaveBeenCalledWith(1, { enabled: true });
    });
  });

  describe('startDeviceAuth', () => {
    it('应保存配置并返回 Device Code', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { startDeviceAuth } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.saveSettings).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            device_code: 'device_abc123',
            user_code: 'USER-1234',
            verification_uri: 'https://enter.pollinations.ai/device',
            interval: 5,
            expires_in: 1800,
          }),
      });

      const result = await startDeviceAuth(1, {
        app_key: 'pk_test123',
        scope: 'usage,keys',
        models: ['openai', 'claude'],
        budget: 10,
        expiry: 86400,
      });

      expect(result.device_code).toBe('device_abc123');
      expect(result.user_code).toBe('USER-1234');
      expect(PollinationsRepository.saveSettings).toHaveBeenCalledWith(
        1,
        expect.objectContaining({
          app_key: 'pk_test123',
          enabled: false,
        })
      );
    });
  });

  describe('pollDeviceAuth', () => {
    it('应处理 authorization_pending 状态（HTTP 400）', async () => {
      const { pollDeviceAuth } = await import('./pollinations.service');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'authorization_pending' }),
      });

      const result = await pollDeviceAuth(1, 'device_abc123');

      expect(result.status).toBe('pending');
    });

    it('应处理 access_denied 状态（HTTP 400）', async () => {
      const { pollDeviceAuth } = await import('./pollinations.service');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'access_denied' }),
      });

      const result = await pollDeviceAuth(1, 'device_abc123');

      expect(result.status).toBe('denied');
    });

    it('应处理 expired_token 状态（HTTP 400）', async () => {
      const { pollDeviceAuth } = await import('./pollinations.service');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 400,
        json: () => Promise.resolve({ error: 'expired_token' }),
      });

      const result = await pollDeviceAuth(1, 'device_abc123');

      expect(result.status).toBe('expired');
    });

    it('应处理授权成功并保存 User Key', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { pollDeviceAuth } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.updateUserKey).mockResolvedValue(undefined);
      vi.mocked(PollinationsRepository.saveSettings).mockResolvedValue(undefined);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ access_token: 'sk_device_token' }),
      });

      const result = await pollDeviceAuth(1, 'device_abc123');

      expect(result.status).toBe('authorized');
      expect(PollinationsRepository.updateUserKey).toHaveBeenCalledWith(1, 'sk_device_token');
      expect(PollinationsRepository.saveSettings).toHaveBeenCalledWith(1, { enabled: true });
    });

    it('应在未知错误时抛出异常', async () => {
      const { pollDeviceAuth } = await import('./pollinations.service');

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        json: () => Promise.resolve({ error: 'unknown_error' }),
      });

      await expect(pollDeviceAuth(1, 'device_abc123')).rejects.toThrow();
    });
  });

  describe('revokeAuth', () => {
    it('应清空 User Key', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { revokeAuth } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.clearUserKey).mockResolvedValue(undefined);

      await revokeAuth(1);

      expect(PollinationsRepository.clearUserKey).toHaveBeenCalledWith(1);
    });
  });

  describe('generateText', () => {
    it('应成功生成文本', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { generateText } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.getUserSettings).mockResolvedValue({
        app_key: 'pk_test',
        user_key: 'sk_test',
        scope: 'usage',
        models: ['openai'],
        budget: 5,
        expiry: 604800,
        enabled: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            id: 'chatcmpl-123',
            object: 'chat.completion',
            created: 1234567890,
            model: 'openai',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: 'Test response',
                },
                finish_reason: 'stop',
              },
            ],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          }),
      });

      const result = await generateText(1, {
        prompt: 'Test prompt',
        model: 'openai',
        max_tokens: 100,
        temperature: 0.7,
      });

      expect(result.text).toBe('Test response');
      expect(result.model).toBe('openai');
      expect(result.usage.total_tokens).toBe(15);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/chat/completions'),
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer sk_test',
            'Content-Type': 'application/json',
          }),
        })
      );
    });

    it('当 API 返回错误时应抛出异常', async () => {
      const PollinationsRepository = await import('./pollinations.repository');
      const { generateText } = await import('./pollinations.service');

      vi.mocked(PollinationsRepository.getUserSettings).mockResolvedValue({
        app_key: 'pk_test',
        user_key: 'sk_test',
        scope: 'usage',
        models: ['openai'],
        budget: 5,
        expiry: 604800,
        enabled: true,
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      await expect(
        generateText(1, {
          prompt: 'Test prompt',
          model: 'openai',
        })
      ).rejects.toThrow();
    });
  });
});
