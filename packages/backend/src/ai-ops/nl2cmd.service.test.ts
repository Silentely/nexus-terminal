/**
 * NL2CMD Service 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import * as NL2CMDService from './nl2cmd.service';
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

vi.mock('axios');

describe('NL2CMD Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAISettings', () => {
    it('应该返回 null 当没有配置时', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      const result = await NL2CMDService.getAISettings();

      expect(result).toBeNull();
      expect(settingsRepository.getSetting).toHaveBeenCalledWith('aiProviderConfig');
    });

    it('应该正确解密 API Key 并返回配置', async () => {
      const mockConfig = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test-key',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockConfig));

      const result = await NL2CMDService.getAISettings();

      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe('sk-test-key');
      expect(crypto.decrypt).toHaveBeenCalledWith('encrypted_sk-test-key');
    });

    it('应该处理解密失败的情况（旧格式明文存储）', async () => {
      const mockConfig = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-plain-text-key',
        model: 'gpt-3.5-turbo',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockConfig));
      vi.mocked(crypto.decrypt).mockImplementation(() => {
        throw new Error('解密失败');
      });

      const result = await NL2CMDService.getAISettings();

      // 解密失败时应保留原始值
      expect(result).not.toBeNull();
      expect(result?.apiKey).toBe('sk-plain-text-key');
    });
  });

  describe('saveAISettings', () => {
    it('应该加密 API Key 并保存配置', async () => {
      const settings = {
        enabled: true,
        provider: 'openai' as const,
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test-key',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions' as const,
      };

      await NL2CMDService.saveAISettings(settings);

      expect(crypto.encrypt).toHaveBeenCalledWith('sk-test-key');
      expect(settingsRepository.setSetting).toHaveBeenCalledWith(
        'aiProviderConfig',
        expect.stringContaining('encrypted_sk-test-key')
      );
    });

    it('应该处理空 API Key', async () => {
      const settings = {
        enabled: false,
        provider: 'openai' as const,
        baseUrl: 'https://api.openai.com',
        apiKey: '',
        model: 'gpt-3.5-turbo',
      };

      await NL2CMDService.saveAISettings(settings);

      expect(crypto.encrypt).not.toHaveBeenCalled();
    });
  });

  describe('generateCommand', () => {
    it('应该在 AI 功能未启用时返回错误', async () => {
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(null);

      const result = await NL2CMDService.generateCommand({
        query: '列出当前目录的文件',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('AI 功能未启用或未配置');
    });

    it('应该检测危险命令并返回警告', async () => {
      const mockSettings = {
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'encrypted_sk-test',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions',
      };
      vi.mocked(settingsRepository.getSetting).mockResolvedValue(JSON.stringify(mockSettings));

      // Mock axios 返回危险命令
      vi.mocked(axios.create).mockReturnValue({
        post: vi.fn().mockResolvedValue({
          data: {
            choices: [{ message: { content: 'rm -rf /' } }],
          },
        }),
      } as any);

      const result = await NL2CMDService.generateCommand({
        query: '删除所有文件',
        osType: 'Linux',
        shellType: 'bash',
      });

      expect(result.success).toBe(true);
      expect(result.command).toBe('rm -rf /');
      expect(result.warning).toBeDefined();
      expect(result.warning).toContain('极度危险');
    });
  });

  describe('testAIConnection', () => {
    it('应该在连接成功时返回 true', async () => {
      vi.mocked(axios.create).mockReturnValue({
        post: vi.fn().mockResolvedValue({
          data: {
            choices: [{ message: { content: 'ls' } }],
          },
        }),
      } as any);

      const result = await NL2CMDService.testAIConnection({
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-test',
        model: 'gpt-3.5-turbo',
        openaiEndpoint: 'chat/completions',
      });

      expect(result).toBe(true);
    });

    it('应该在连接失败时返回 false', async () => {
      vi.mocked(axios.create).mockReturnValue({
        post: vi.fn().mockRejectedValue(new Error('Connection failed')),
      } as any);

      const result = await NL2CMDService.testAIConnection({
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'invalid-key',
        model: 'gpt-3.5-turbo',
      });

      expect(result).toBe(false);
    });
  });
});
