/**
 * NL2CMD Service 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { settingsRepository } from '../settings/settings.repository';
import * as crypto from '../utils/crypto';

// Mock 依赖
vi.mock('../settings/settings.repository', () => ({
  settingsRepository: {
    getSetting: vi.fn(),
    setSetting: vi.fn(),
  },
}));

vi.mock('../utils/crypto', () => ({
  encrypt: vi.fn((text: string) => `encrypted_${text}`),
  decrypt: vi.fn((text: string) => text.replace('encrypted_', '')),
}));

describe('NL2CMD Service', () => {
  // Axios mock 状态
  let mockPost: ReturnType<typeof vi.fn>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let mockIsAxiosError: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // 初始化 mock 函数
    mockPost = vi.fn();
    mockCreate = vi.fn().mockReturnValue({ post: mockPost });
    mockIsAxiosError = vi.fn();

    // 设置 axios mock（包含 default export 以兼容 axios.create 调用方式）
    vi.doMock('axios', () => ({
      default: {
        create: mockCreate,
        isAxiosError: mockIsAxiosError,
      },
      create: mockCreate,
      isAxiosError: mockIsAxiosError,
    }));

    // 重置模块缓存，确保每次测试都加载新的服务实例
    vi.resetModules();

    // 清除所有 mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAISettings', () => {
    it('应该返回 null 当没有配置时', async () => {
      const { getAISettings } = await import('./nl2cmd.service');
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      const result = await getAISettings();

      expect(result).toBeNull();
      expect(settingsRepository.getSetting).toHaveBeenCalledWith('aiProviderConfig');
    });

    it('应该正确解密 API Key 并返回配置', async () => {
      const { getAISettings } = await import('./nl2cmd.service');
      const mockConfig = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test-key',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await getAISettings();

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe('sk-test-key');
      expect(crypto.decrypt).toHaveBeenCalledWith('encrypted_sk-test-key');
    });

    it('应该正确处理 streamingEnabled 布尔值', async () => {
      const { getAISettings } = await import('./nl2cmd.service');
      const mockConfig = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test-key',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: true,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await getAISettings();

      expect(result).not.toBeNull();
      expect(result?.streamingEnabled).toBe(true);
    });
  });

  describe('saveAISettings', () => {
    it('应该加密 API Key 并保存配置', async () => {
      const { saveAISettings } = await import('./nl2cmd.service');
      const settings = {
        enabled: true,
        provider: 'openai' as const,
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test-key',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions' as const,
      };

      await saveAISettings(settings);

      expect(crypto.encrypt).toHaveBeenCalledWith('sk-test-key');
      expect(settingsRepository.setSetting).toHaveBeenCalledWith(
        'aiProviderConfig',
        expect.stringContaining('encrypted_sk-test-key')
      );
    });

    it('应该正确保存 streamingEnabled', async () => {
      const { saveAISettings } = await import('./nl2cmd.service');
      const settings = {
        enabled: true,
        provider: 'openai' as const,
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test-key',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'chat/completions' as const,
        streamingEnabled: true,
      };

      await saveAISettings(settings);

      const savedJson = vi.mocked(settingsRepository.setSetting).mock.calls[0][1];
      const savedConfig = JSON.parse(savedJson);
      expect(savedConfig.streamingEnabled).toBe(true);
    });
  });

  describe('generateCommand', () => {
    it('应该在 AI 功能未启用时返回错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      const result = await generateCommand({
        query: '列出当前目录的文件',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('AI 功能未启用或未配置');
    });

    it('应该成功生成命令', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'ls -la' } }],
        },
      });

      const result = await generateCommand({
        query: '列出当前目录的详细信息',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url, requestBody] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe('/v1/chat/completions');
      expect(requestBody).toEqual(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          max_completion_tokens: expect.any(Number),
        })
      );
      expect((requestBody as { max_tokens?: unknown }).max_tokens).toBeUndefined();

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls -la');
    });

    it('OpenAI Chat Completions 应该在不支持 max_completion_tokens 时回退到 max_tokens', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost
        .mockRejectedValueOnce({
          response: {
            status: 400,
            data: {
              error: { message: 'Unrecognized request argument supplied: max_completion_tokens' },
            },
          },
          isAxiosError: true,
          code: undefined,
          config: { timeout: 30000 },
        })
        .mockResolvedValueOnce({
          data: {
            choices: [{ message: { content: 'ls -la' } }],
          },
        });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({
        query: '列出当前目录的详细信息',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(mockPost).toHaveBeenCalledTimes(2);
      const [firstUrl, firstBody] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
      const [secondUrl, secondBody] = mockPost.mock.calls[1] as [string, Record<string, unknown>];

      expect(firstUrl).toBe('/v1/chat/completions');
      expect(firstBody).toEqual(
        expect.objectContaining({
          max_completion_tokens: expect.any(Number),
        })
      );
      expect((firstBody as { max_tokens?: unknown }).max_tokens).toBeUndefined();

      expect(secondUrl).toBe('/v1/chat/completions');
      expect(secondBody).toEqual(
        expect.objectContaining({
          max_tokens: expect.any(Number),
        })
      );
      expect(
        (secondBody as { max_completion_tokens?: unknown }).max_completion_tokens
      ).toBeUndefined();

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls -la');
    });

    it('OpenAI Responses 应该使用 max_output_tokens', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'responses',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          response: 'ls -la',
        },
      });

      const result = await generateCommand({
        query: '列出当前目录的详细信息',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const [url, requestBody] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
      expect(url).toBe('/v1/responses');
      expect(requestBody).toEqual(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          max_output_tokens: expect.any(Number),
        })
      );
      expect((requestBody as { max_tokens?: unknown }).max_tokens).toBeUndefined();

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls -la');
    });

    it('应该检测危险命令并返回警告', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'rm -rf /' } }],
        },
      });

      const result = await generateCommand({
        query: '删除所有文件',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('rm -rf /');
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('极度危险');
    });

    it('应该在流式响应模式下返回 streaming: true', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: true,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      // 流式响应需要 Buffer 格式的 SSE 数据
      const streamData = Buffer.from(
        'data: {"choices":[{"delta":{"content":"ls"}}]}\ndata: [DONE]\n'
      );
      mockPost.mockResolvedValue({
        data: streamData,
      });

      const result = await generateCommand({
        query: '列出当前目录',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.streaming).toBe(true);
    });

    it('应该在非流式模式下返回 streaming: false', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'ls' } }],
        },
      });

      const result = await generateCommand({
        query: '列出当前目录',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.streaming).toBe(false);
    });

    it('应该正确清理反引号包裹的代码', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: '`ls -la`' } }],
        },
      });

      const result = await generateCommand({
        query: '列出当前目录',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls -la');
    });

    it('应该处理 API 401 错误并返回友好的错误信息', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        response: { status: 401, data: { error: { message: 'Invalid API key' } } },
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({
        query: 'test',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('API Key 无效');
    });

    it('应该处理超时错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        code: 'ECONNABORTED',
        config: { timeout: 30000 },
        isAxiosError: true,
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({
        query: 'test',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('超时');
    });

    it('应该处理 API 429 错误（速率限制）', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        response: { status: 429, data: { error: { message: 'Rate limit exceeded' } } },
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({
        query: 'test',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('频率超限');
    });

    it('应该处理 API 500 错误（服务器错误）', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        response: { status: 500, data: {} },
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({
        query: 'test',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('暂时不可用');
    });
  });

  describe('clearAxiosClientCache', () => {
    it('应该清除所有缓存的客户端', async () => {
      // 动态导入服务模块
      const { generateCommand, clearAxiosClientCache } = await import('./nl2cmd.service');

      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
        streamingEnabled: false,
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: { choices: [{ message: { content: 'ls' } }] },
      });

      // 第一次调用，创建缓存的客户端
      await generateCommand({ query: 'test' });

      // 清除缓存
      clearAxiosClientCache();

      // 第二次调用，应该创建新的客户端
      await generateCommand({ query: 'test' });

      // 验证 create 被调用了至少 2 次
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });
});
