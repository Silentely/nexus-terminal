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
        openaiEndpoint: '/chat/completions',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await getAISettings();

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe('sk-test-key');
      expect(crypto.decrypt).toHaveBeenCalledWith('encrypted_sk-test-key');
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
        openaiEndpoint: '/chat/completions' as const,
      };

      await saveAISettings(settings);

      expect(crypto.encrypt).toHaveBeenCalledWith('sk-test-key');
      expect(settingsRepository.setSetting).toHaveBeenCalledWith(
        'aiProviderConfig',
        expect.stringContaining('encrypted_sk-test-key'),
      );
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
        openaiEndpoint: '/chat/completions',
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
      expect(url).toBe('https://api.openai.com/chat/completions');
      expect(requestBody).toEqual(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          max_tokens: expect.any(Number),
        }),
      );

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
        openaiEndpoint: '/responses',
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
      expect(url).toBe('https://api.openai.com/responses');
      expect(requestBody).toEqual(
        expect.objectContaining({
          model: 'gpt-4o-mini',
          max_output_tokens: expect.any(Number),
        }),
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
        openaiEndpoint: '/chat/completions',
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

    it('应该正确清理反引号包裹的代码', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: '/chat/completions',
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
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      // 初始请求 + 2 次重试均返回 429
      mockPost
        .mockRejectedValueOnce({
          response: { status: 429, data: { error: { message: 'Rate limit exceeded' } } },
          isAxiosError: true,
          code: undefined,
          config: { timeout: 30000 },
        })
        .mockRejectedValueOnce({
          response: { status: 429, data: { error: { message: 'Rate limit exceeded' } } },
          isAxiosError: true,
          code: undefined,
          config: { timeout: 30000 },
        })
        .mockRejectedValueOnce({
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

      expect(mockPost).toHaveBeenCalledTimes(3);
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
      const { generateCommand, clearAxiosClientCache } = await import('./nl2cmd.service');

      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: { choices: [{ message: { content: 'ls' } }] },
      });

      await generateCommand({ query: 'test' });
      clearAxiosClientCache();
      await generateCommand({ query: 'test' });

      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('testAIConnection', () => {
    it('应该成功测试 OpenAI 连接', async () => {
      const { testAIConnection } = await import('./nl2cmd.service');
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      mockPost.mockResolvedValue({
        data: { choices: [{ message: { content: 'ls -la' } }] },
      });

      const result = await testAIConnection({
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-4o-mini',
      });

      expect(result).toBe(true);
    });

    it('应该成功测试 Claude 连接', async () => {
      const { testAIConnection } = await import('./nl2cmd.service');
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      mockPost.mockResolvedValue({
        data: { content: [{ text: 'ls -la' }], usage: { input_tokens: 10, output_tokens: 10 } },
      });

      const result = await testAIConnection({
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'sk-ant-test',
        model: 'claude-3-haiku',
      });

      expect(result).toBe(true);
    });

    it('连接失败时应返回 false', async () => {
      const { testAIConnection } = await import('./nl2cmd.service');
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      mockPost.mockRejectedValue(new Error('Connection refused'));
      mockIsAxiosError.mockReturnValue(false);

      const result = await testAIConnection({
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-bad',
        model: 'gpt-4o-mini',
      });

      expect(result).toBe(false);
    });

    it('不支持的 provider 应返回 false', async () => {
      const { testAIConnection } = await import('./nl2cmd.service');
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      const result = await testAIConnection({
        provider: 'unsupported' as any,
        baseUrl: 'https://example.com',
        apiKey: 'key',
        model: 'model',
      });

      expect(result).toBe(false);
    });
  });

  describe('generateCommand - 不支持的 provider', () => {
    it('不支持的 provider 应返回错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'unsupported',
        baseUrl: 'https://example.com',
        apiKey: 'encrypted_key',
        model: 'model',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('不支持的 AI Provider');
    });
  });

  describe('generateCommand - Claude provider', () => {
    it('应该正确调用 Claude API', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'encrypted_sk-ant-test',
        model: 'claude-3-haiku-20240307',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          content: [{ text: 'ls -la' }],
          usage: { input_tokens: 10, output_tokens: 10 },
        },
      });

      const result = await generateCommand({
        query: '列出文件',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls -la');
    });

    it('Claude API 返回空内容应报错', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'claude',
        baseUrl: 'https://api.anthropic.com',
        apiKey: 'encrypted_sk-ant-test',
        model: 'claude-3-haiku',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: { content: [], usage: {} },
      });

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
    });
  });

  describe('generateCommand - 空命令', () => {
    it('AI 返回空命令时应返回错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: { choices: [{ message: { content: '' } }] },
      });

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('未能生成有效命令');
    });
  });

  describe('generateCommand - 非 Axios 错误', () => {
    it('非 Axios 错误应返回通用错误信息', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue(new Error('Something went wrong'));
      mockIsAxiosError.mockReturnValue(false);

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Something went wrong');
    });
  });

  describe('generateCommand - 403 错误', () => {
    it('应返回权限不足错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        response: { status: 403, data: { error: { message: 'Forbidden' } } },
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('权限不足');
    });
  });

  describe('generateCommand - 404 错误', () => {
    it('应返回端点不存在错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        response: { status: 404, data: { error: { message: 'Not Found' } } },
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('不存在');
    });
  });

  describe('generateCommand - 400 错误', () => {
    it('应返回请求参数错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        response: { status: 400, data: { error: { message: 'Bad Request' } } },
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('参数错误');
    });
  });

  describe('generateCommand - 网络错误', () => {
    it('无响应时应返回网络错误', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockRejectedValue({
        request: {},
        isAxiosError: true,
        code: undefined,
        config: { timeout: 30000 },
      });
      mockIsAxiosError.mockReturnValue(true);

      const result = await generateCommand({ query: 'test' });

      expect(result.success).toBe(false);
      expect(result.error).toContain('无法连接');
    });
  });

  describe('generateCommand - JSON 响应清理', () => {
    it('应解析 JSON 格式的命令输出', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: '{"command": "ls -la"}' } }],
        },
      });

      const result = await generateCommand({ query: '列出文件' });

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls -la');
    });

    it('应处理带 Markdown 围栏的 JSON 响应', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: '```json\n{"command": "ls"}\n```' } }],
        },
      });

      const result = await generateCommand({ query: '列出文件' });

      expect(result.success).toBe(true);
      expect(result.command).toBe('ls');
    });
  });

  describe('generateCommand - 危险命令检测', () => {
    it('dd 命令应返回警告', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'dd if=/dev/zero of=/dev/sda' } }],
        },
      });

      const result = await generateCommand({ query: '写入磁盘' });

      expect(result.success).toBe(true);
      expect(result.warning).toContain('磁盘设备');
    });

    it('chmod 777 应返回警告', async () => {
      const { generateCommand } = await import('./nl2cmd.service');
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-4o-mini',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      mockPost.mockResolvedValue({
        data: {
          choices: [{ message: { content: 'chmod 777 /var/www' } }],
        },
      });

      const result = await generateCommand({ query: '修改权限' });

      expect(result.success).toBe(true);
      expect(result.warning).toContain('完全权限');
    });
  });
});
