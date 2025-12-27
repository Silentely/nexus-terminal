/**
 * NL2CMD Controller 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Request, Response } from 'express';
import * as NL2CMDController from './nl2cmd.controller';
import * as NL2CMDService from './nl2cmd.service';

// Mock Service
vi.mock('./nl2cmd.service', () => ({
  generateCommand: vi.fn(),
  getAISettings: vi.fn(),
  saveAISettings: vi.fn(),
  testAIConnection: vi.fn(),
  clearAxiosClientCache: vi.fn(),
}));

// 创建 mock 请求和响应对象
function createMockRequest(options: { body?: any; session?: any; params?: any }): Request {
  return {
    body: options.body || {},
    session: options.session || { userId: 1 },
    params: options.params || {},
  } as Request;
}

function createMockResponse(): Response {
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  };
  return res as Response;
}

describe('NL2CMD Controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('generateCommand', () => {
    it('应该返回 401 当用户未登录时', async () => {
      const req = createMockRequest({ body: { query: 'test' }, session: {} });
      const res = createMockResponse();

      await NL2CMDController.generateCommand(req, res);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: '未授权' });
    });

    it('应该返回 400 当查询内容为空时', async () => {
      const req = createMockRequest({ body: { query: '' } });
      const res = createMockResponse();

      await NL2CMDController.generateCommand(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: '查询内容不能为空' });
    });

    it('应该返回 400 当查询内容超过 500 字符时', async () => {
      const longQuery = 'a'.repeat(501);
      const req = createMockRequest({ body: { query: longQuery } });
      const res = createMockResponse();

      await NL2CMDController.generateCommand(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, error: '查询内容不能超过 500 字符' });
    });

    it('应该成功调用 Service 并返回结果', async () => {
      const mockResult = { success: true, command: 'ls -la' };
      vi.mocked(NL2CMDService.generateCommand).mockResolvedValue(mockResult);

      const req = createMockRequest({
        body: { query: '列出当前目录的文件', osType: 'Linux', shellType: 'bash' },
      });
      const res = createMockResponse();

      await NL2CMDController.generateCommand(req, res);

      expect(NL2CMDService.generateCommand).toHaveBeenCalledWith(
        {
          query: '列出当前目录的文件',
          osType: 'Linux',
          shellType: 'bash',
          currentPath: undefined,
        },
        expect.any(String)
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(mockResult);
    });
  });

  describe('getAISettings', () => {
    it('应该返回默认配置当没有配置时', async () => {
      vi.mocked(NL2CMDService.getAISettings).mockResolvedValue(null);

      const req = createMockRequest({});
      const res = createMockResponse();

      await NL2CMDController.getAISettings(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        settings: {
          enabled: false,
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: '',
          model: 'gpt-4o-mini',
          openaiEndpoint: 'chat/completions',
          rateLimitEnabled: true,
          streamingEnabled: false,
        },
      });
    });

    it('应该脱敏 API Key 后返回', async () => {
      vi.mocked(NL2CMDService.getAISettings).mockResolvedValue({
        enabled: true,
        provider: 'openai',
        baseUrl: 'https://api.openai.com',
        apiKey: 'sk-1234567890abcdef',
        model: 'gpt-4',
        openaiEndpoint: 'chat/completions',
      });

      const req = createMockRequest({});
      const res = createMockResponse();

      await NL2CMDController.getAISettings(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      const response = vi.mocked(res.json).mock.calls[0][0];
      expect(response.settings.apiKey).toBe('sk-12345...');
    });
  });

  describe('saveAISettings', () => {
    it('应该验证 enabled 参数类型', async () => {
      const req = createMockRequest({
        body: { enabled: 'true', provider: 'openai', baseUrl: 'url', model: 'model' },
      });
      const res = createMockResponse();

      await NL2CMDController.saveAISettings(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: 'enabled 必须是布尔值' });
    });

    it('应该验证 provider 参数值', async () => {
      const req = createMockRequest({
        body: { enabled: true, provider: 'invalid', baseUrl: 'url', model: 'model' },
      });
      const res = createMockResponse();

      await NL2CMDController.saveAISettings(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'provider 必须是 openai, gemini 或 claude',
      });
    });

    it('应该成功保存配置', async () => {
      vi.mocked(NL2CMDService.saveAISettings).mockResolvedValue();

      const req = createMockRequest({
        body: {
          enabled: true,
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: 'sk-test',
          model: 'gpt-4',
          openaiEndpoint: 'chat/completions',
        },
      });
      const res = createMockResponse();

      await NL2CMDController.saveAISettings(req, res);

      expect(NL2CMDService.saveAISettings).toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: 'AI 配置已保存' });
    });
  });

  describe('testAIConnection', () => {
    it('应该返回连接成功消息', async () => {
      vi.mocked(NL2CMDService.testAIConnection).mockResolvedValue(true);

      const req = createMockRequest({
        body: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: 'sk-test',
          model: 'gpt-4',
        },
      });
      const res = createMockResponse();

      await NL2CMDController.testAIConnection(req, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({ success: true, message: '连接测试成功' });
    });

    it('应该返回连接失败消息', async () => {
      vi.mocked(NL2CMDService.testAIConnection).mockResolvedValue(false);

      const req = createMockRequest({
        body: {
          provider: 'openai',
          baseUrl: 'https://api.openai.com',
          apiKey: 'invalid-key',
          model: 'gpt-4',
        },
      });
      const res = createMockResponse();

      await NL2CMDController.testAIConnection(req, res);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({ success: false, message: '连接测试失败' });
    });
  });
});
