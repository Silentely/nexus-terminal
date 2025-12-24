/**
 * NL2CMD (Natural Language to Command) Service
 * 负责与各个 AI Provider 通信，将自然语言转换为命令行指令
 */

import axios, { AxiosInstance } from 'axios';
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
    await settingsRepository.setSetting(AI_SETTINGS_KEY, JSON.stringify(settings));
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
 * 构建 NL2CMD Prompt
 */
function buildNL2CMDPrompt(request: NL2CMDRequest): string {
  const { os, shell } = detectSystemInfo(request.osType, request.shellType);
  const currentPath = request.currentPath || '~';

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

用户描述：${request.query}

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
        content:
          '你是一个专业的命令行助手，专门帮助用户将自然语言转换为精确的命令行指令。',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 500,
  };

  const response = await client.post<OpenAIChatResponse>('/v1/chat/completions', requestBody);
  const content = response.data.choices[0]?.message?.content || '';
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
  const content = response.data.response || '';
  return content.trim();
}

/**
 * 调用 Gemini API
 */
async function callGemini(config: AIProviderConfig, prompt: string): Promise<string> {
  const client = axios.create({
    baseURL: config.baseUrl,
    timeout: 30000,
  });

  const requestBody: GeminiRequest = {
    contents: [
      {
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

  // Gemini API URL: https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={apiKey}
  const url = `${config.baseUrl}/v1beta/models/${config.model}:generateContent?key=${config.apiKey}`;

  const response = await client.post<GeminiResponse>(url, requestBody);
  const content = response.data.candidates[0]?.content?.parts[0]?.text || '';
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
  const content = response.data.content[0]?.text || '';
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

    // 清理命令输出
    const command = cleanCommandOutput(rawCommand);

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
      if (error.response) {
        errorMessage = `API 错误: ${error.response.status} - ${JSON.stringify(error.response.data)}`;
      } else if (error.request) {
        errorMessage = '无法连接到 AI 服务，请检查网络或 Base URL 配置';
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
