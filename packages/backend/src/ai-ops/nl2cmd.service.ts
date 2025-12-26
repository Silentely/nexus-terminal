/**
 * NL2CMD (Natural Language to Command) Service
 * 负责与各个 AI Provider 通信，将自然语言转换为命令行指令
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  AIProvider,
  AIProviderConfig,
  NL2CMDRequest,
  NL2CMDResponse,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIResponsesRequest,
  OpenAIResponsesResponse,
  GeminiRequest,
  GeminiResponse,
  ClaudeRequest,
  ClaudeResponse,
  AISettings,
} from './nl2cmd.types';
import { settingsRepository } from '../settings/settings.repository';
import { encrypt, decrypt } from '../utils/crypto';

const AI_SETTINGS_KEY = 'aiProviderConfig';

/**
 * 获取 AI Provider 配置
 */
export async function getAISettings(): Promise<AISettings | null> {
  try {
    const configJson = await settingsRepository.getSetting(AI_SETTINGS_KEY);
    if (!configJson) {
      return null;
    }
    const config = JSON.parse(configJson) as AISettings;

    // 确保 enabled 是 boolean 类型
    if (config) {
      config.enabled = !!config.enabled;
    }

    // 解密 API Key
    if (config.apiKey) {
      try {
        config.apiKey = decrypt(config.apiKey);
      } catch (decryptError) {
        // 如果解密失败，可能是旧的明文存储，保持原样
        console.warn('[NL2CMD] API Key 解密失败，可能是旧格式明文存储');
      }
    }
    return config;
  } catch (error) {
    console.error('[NL2CMD] 获取 AI 配置失败:', error);
    return null;
  }
}

/**
 * 保存 AI Provider 配置
 */
export async function saveAISettings(settings: AISettings): Promise<void> {
  try {
    // 加密 API Key 后存储
    const settingsToStore = {
      ...settings,
      apiKey: settings.apiKey ? encrypt(settings.apiKey) : '',
    };
    await settingsRepository.setSetting(AI_SETTINGS_KEY, JSON.stringify(settingsToStore));
  } catch (error) {
    console.error('[NL2CMD] 保存 AI 配置失败:', error);
    throw new Error('保存 AI 配置失败');
  }
}

/**
 * 检测操作系统类型和Shell类型
 */
function detectSystemInfo(osType?: string, shellType?: string): { os: string; shell: string } {
  // 如果客户端提供了信息，优先使用
  if (osType && shellType) {
    return { os: osType, shell: shellType };
  }

  // 否则基于服务器环境检测（作为后备）
  const platform = process.platform;
  let os = 'Linux';
  let shell = 'bash';

  switch (platform) {
    case 'linux':
      os = 'Linux';
      shell = process.env.SHELL?.includes('zsh') ? 'zsh' : 'bash';
      break;
    case 'darwin':
      os = 'macOS';
      shell = process.env.SHELL?.includes('zsh') ? 'zsh' : 'bash';
      break;
    case 'win32':
      os = 'Windows';
      shell = 'PowerShell';
      break;
    default:
      os = 'Linux';
      shell = 'bash';
  }

  return { os: osType || os, shell: shellType || shell };
}

/**
 * 清理用户输入，防止 Prompt 注入
 */
function sanitizeUserInput(input: string): string {
  return input
    .replace(/[\r\n]+/g, ' ') // 移除换行符
    .replace(/```/g, '') // 移除代码块标记
    .replace(/\${/g, '') // 移除模板字符串标记
    .trim()
    .slice(0, 500); // 限制长度
}

/**
 * 构建 NL2CMD Prompt
 */
function buildNL2CMDPrompt(request: NL2CMDRequest): string {
  const { os, shell } = detectSystemInfo(request.osType, request.shellType);
  const currentPath = request.currentPath || '~';
  // 清理用户输入，防止 Prompt 注入
  const sanitizedQuery = sanitizeUserInput(request.query);

  return `你是一个专业的命令行助手。请将用户的自然语言描述转换为对应的命令行指令。

系统信息：
- 操作系统：${os}
- Shell 类型：${shell}
- 当前路径：${currentPath}

要求：
1. 只返回命令本身，不要添加任何解释或额外文本
2. 不要使用 Markdown 代码块格式（不要用 \`\`\`）
3. 如果需要多条命令，使用 && 或 ; 连接
4. 确保命令语法适配指定的操作系统和 Shell 类型
5. 对于危险操作（如 rm -rf），添加 --interactive 或 -i 等安全选项

用户描述：${sanitizedQuery}

请直接返回命令：`;
}

/**
 * 检测命令是否危险
 */
function detectDangerousCommand(command: string): string | undefined {
  const dangerousPatterns = [
    { pattern: /rm\s+(-[rf]*\s*)+\//, warning: '此命令将删除根目录，极度危险！' },
    { pattern: /rm\s+-rf\s+[~\/]/, warning: '此命令可能删除重要文件，请谨慎执行' },
    { pattern: /dd\s+if=.*of=\/dev\/sd/, warning: '此命令将直接写入磁盘设备，可能导致数据丢失' },
    { pattern: /mkfs/, warning: '此命令将格式化文件系统，将丢失所有数据' },
    { pattern: /:\(\)\{.*\}/, warning: '检测到 Fork Bomb 代码，将耗尽系统资源' },
    { pattern: /chmod\s+777/, warning: '此命令将赋予所有用户完全权限，存在安全风险' },
    { pattern: />\s*\/dev\/sd/, warning: '此命令将直接写入磁盘设备，可能破坏数据' },
  ];

  for (const { pattern, warning } of dangerousPatterns) {
    if (pattern.test(command)) {
      return warning;
    }
  }

  return undefined;
}

/**
 * 调用 OpenAI API (Chat Completions)
 */
async function callOpenAIChatCompletions(
  config: AIProviderConfig,
  prompt: string
): Promise<string> {
  const client = axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    timeout: 30000,
  });

  const requestBody: OpenAIChatRequest = {
    model: config.model,
    messages: [
      {
        role: 'system',
        content: '你是一个专业的命令行助手，专门帮助用户将自然语言转换为精确的命令行指令。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_completion_tokens: 500,
  };

  const response = await client.post<OpenAIChatResponse>('/v1/chat/completions', requestBody);

  // 安全检查：确保响应结构正确
  const choices = response.data?.choices;
  if (!choices || choices.length === 0) {
    throw new Error('OpenAI API 返回空响应');
  }

  const content = choices[0]?.message?.content || '';
  return content.trim();
}

/**
 * 调用 OpenAI API (Responses)
 */
async function callOpenAIResponses(config: AIProviderConfig, prompt: string): Promise<string> {
  const client = axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    timeout: 30000,
  });

  const requestBody: OpenAIResponsesRequest = {
    model: config.model,
    input: prompt,
    temperature: 0.3,
    max_tokens: 500,
  };

  const response = await client.post<OpenAIResponsesResponse>('/v1/responses', requestBody);

  // 安全检查：确保响应结构正确
  if (!response.data || !response.data.response) {
    throw new Error('OpenAI Responses API 返回空响应');
  }

  const content = response.data.response || '';
  return content.trim();
}

/**
 * 调用 Gemini API
 * Gemini API URL 格式: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * 文档参考: https://ai.google.dev/api/generate-content
 */
async function callGemini(config: AIProviderConfig, prompt: string): Promise<string> {
  const requestBody: GeminiRequest = {
    contents: [
      {
        role: 'user', // 明确指定角色
        parts: [
          {
            text: prompt,
          },
        ],
      },
    ],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 500,
    },
  };

  // 构建完整 URL，API Key 通过 query 参数传递（Gemini API 官方方式）
  const baseUrl = config.baseUrl.replace(/\/$/, ''); // 移除末尾斜杠
  const url = `${baseUrl}/v1beta/models/${config.model}:generateContent`;

  const response = await axios.post<GeminiResponse>(url, requestBody, {
    params: { key: config.apiKey },
    headers: { 'Content-Type': 'application/json' },
    timeout: 30000,
  });

  // 安全检查：确保响应结构正确
  const candidates = response.data?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Gemini API 返回空响应');
  }

  const content = candidates[0]?.content?.parts?.[0]?.text || '';
  return content.trim();
}

/**
 * 调用 Claude API
 */
async function callClaude(config: AIProviderConfig, prompt: string): Promise<string> {
  const client = axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
    },
    timeout: 30000,
  });

  const requestBody: ClaudeRequest = {
    model: config.model,
    max_tokens: 500,
    temperature: 0.3,
    system: '你是一个专业的命令行助手，专门帮助用户将自然语言转换为精确的命令行指令。',
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  };

  const response = await client.post<ClaudeResponse>('/v1/messages', requestBody);

  // 安全检查：确保响应结构正确
  const contentArray = response.data?.content;
  if (!contentArray || contentArray.length === 0) {
    throw new Error('Claude API 返回空响应');
  }

  const content = contentArray[0]?.text || '';
  return content.trim();
}

/**
 * 清理 AI 返回的命令（移除 Markdown 代码块等）
 */
function cleanCommandOutput(output: string): string {
  // 移除 Markdown 代码块
  let cleaned = output.replace(/```[\w]*\n?/g, '').replace(/```/g, '');

  // 移除开头的命令提示符
  cleaned = cleaned.replace(/^\$\s+/, '').replace(/^>\s+/, '');

  // 移除多余的换行和空格
  cleaned = cleaned.trim();

  // 如果包含多行，只取第一行（通常是命令本身）
  const lines = cleaned.split('\n');
  if (lines.length > 1) {
    // 查找第一行非空且看起来像命令的行
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && !trimmed.startsWith('//')) {
        return trimmed;
      }
    }
  }

  return cleaned;
}

/**
 * 生成命令（主函数）
 */
export async function generateCommand(request: NL2CMDRequest): Promise<NL2CMDResponse> {
  try {
    // 获取 AI 配置
    const settings = await getAISettings();
    if (!settings || !settings.enabled) {
      return {
        success: false,
        error: 'AI 功能未启用或未配置',
      };
    }

    // 构建配置
    const config: AIProviderConfig = {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      openaiEndpoint: settings.openaiEndpoint,
    };

    // 构建 Prompt
    const prompt = buildNL2CMDPrompt(request);

    if (process.env.NODE_ENV === 'development') {
      console.log('[NL2CMD Debug] Request:', {
        ...request,
        query: request.query.substring(0, 50) + (request.query.length > 50 ? '...' : ''),
      });
      console.log('[NL2CMD Debug] Generated Prompt:', prompt);
    }

    // 根据不同 Provider 调用对应的 API
    let rawCommand: string;
    switch (config.provider) {
      case 'openai':
        if (config.openaiEndpoint === 'responses') {
          rawCommand = await callOpenAIResponses(config, prompt);
        } else {
          rawCommand = await callOpenAIChatCompletions(config, prompt);
        }
        break;
      case 'gemini':
        rawCommand = await callGemini(config, prompt);
        break;
      case 'claude':
        rawCommand = await callClaude(config, prompt);
        break;
      default:
        return {
          success: false,
          error: '不支持的 AI Provider',
        };
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[NL2CMD Debug] Raw AI Output:', rawCommand);
    }

    // 清理命令输出
    const command = cleanCommandOutput(rawCommand);

    if (!command) {
      console.warn('[NL2CMD] Warning: AI returned empty command. Raw output:', rawCommand);
      return {
        success: false,
        error: 'AI 未能生成有效命令，请尝试更详细的描述',
      };
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[NL2CMD Debug] Cleaned Command:', command);
    }

    // 检测危险命令
    const warning = detectDangerousCommand(command);

    return {
      success: true,
      command,
      warning,
    };
  } catch (error: any) {
    console.error('[NL2CMD] 生成命令失败:', error);

    // 提供更友好的错误信息
    let errorMessage = '生成命令失败';
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const data = error.response?.data;

      // 根据状态码提供更具体的错误提示
      switch (status) {
        case 400:
          errorMessage = '请求参数错误，请检查模型名称是否正确';
          break;
        case 401:
          errorMessage = 'API Key 无效或已过期，请检查配置';
          break;
        case 403:
          errorMessage = 'API Key 权限不足或账户被禁用';
          break;
        case 404:
          errorMessage = '请求的 API 端点或模型不存在，请检查 Base URL 和模型名称';
          break;
        case 429:
          console.warn('[NL2CMD] Upstream 429 Error Details:', {
            url: error.config?.url,
            baseURL: error.config?.baseURL,
            status,
            data,
          });
          errorMessage = 'API 请求频率超限或配额已耗尽，请稍后再试';
          if (data && typeof data === 'object' && (data as any).error?.message) {
            errorMessage += `: ${(data as any).error.message}`;
          }
          break;
        case 500:
        case 502:
        case 503:
          errorMessage = 'AI 服务暂时不可用，请稍后重试';
          break;
        default:
          if (error.response) {
            // 尝试提取错误详情
            const errorDetail =
              typeof data === 'object'
                ? data?.error?.message || data?.message || JSON.stringify(data)
                : data;
            errorMessage = `API 错误 (${status}): ${errorDetail}`;
          } else if (error.request) {
            errorMessage = '无法连接到 AI 服务，请检查网络连接或 Base URL 配置';
          } else {
            errorMessage = error.message || '请求配置错误';
          }
      }
    } else if (error.message) {
      errorMessage = error.message;
    }

    return {
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * 测试 AI Provider 连接
 */
export async function testAIConnection(config: AIProviderConfig): Promise<boolean> {
  try {
    const testRequest: NL2CMDRequest = {
      query: '列出当前目录的文件',
      osType: 'Linux',
      shellType: 'bash',
    };

    const prompt = buildNL2CMDPrompt(testRequest);

    // 根据不同 Provider 测试连接
    switch (config.provider) {
      case 'openai':
        if (config.openaiEndpoint === 'responses') {
          await callOpenAIResponses(config, prompt);
        } else {
          await callOpenAIChatCompletions(config, prompt);
        }
        break;
      case 'gemini':
        await callGemini(config, prompt);
        break;
      case 'claude':
        await callClaude(config, prompt);
        break;
      default:
        return false;
    }

    return true;
  } catch (error) {
    console.error('[NL2CMD] 测试连接失败:', error);
    return false;
  }
}
