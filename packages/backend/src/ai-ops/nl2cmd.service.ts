/**
 * NL2CMD (Natural Language to Command) Service
 * 负责与各个 AI Provider 通信，将自然语言转换为命令行指令
 *
 * 优化特性：
 * - Axios 客户端单例复用
 * - 流式响应支持
 * - 快速失败（不重试）
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
import { NL2CMD_CONFIG, safeBaseUrlForLog, shouldLogTiming } from './nl2cmd.constants';
import { settingsRepository } from '../settings/settings.repository';
import { encrypt, decrypt } from '../utils/crypto';

const AI_SETTINGS_KEY = 'aiProviderConfig';

/**
 * Axios 客户端缓存（按 baseUrl + apiKey 缓存）
 */
const axiosClientCache = new Map<string, AxiosInstance>();

/**
 * 获取或创建 Axios 客户端（单例复用）
 */
function getAxiosClient(baseUrl: string, apiKey: string): AxiosInstance {
  const cacheKey = `${baseUrl}::${apiKey.substring(0, 8)}`;

  let client = axiosClientCache.get(cacheKey);
  if (!client) {
    client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS,
    });
    axiosClientCache.set(cacheKey, client);
  }

  return client;
}

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

    // 确保 enabled 和 streamingEnabled 是 boolean 类型
    if (config) {
      config.enabled = !!config.enabled;
      config.streamingEnabled = !!config.streamingEnabled;
    }

    // 解密 API Key
    if (config.apiKey) {
      try {
        config.apiKey = decrypt(config.apiKey);
      } catch {
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
 * 检测操作系统类型和 Shell 类型
 */
function detectSystemInfo(osType?: string, shellType?: string): { os: string; shell: string } {
  if (osType && shellType) {
    return { os: osType, shell: shellType };
  }

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
    .replace(/[\r\n]+/g, ' ')
    .replace(/```/g, '')
    .replace(/\${/g, '')
    .trim()
    .slice(0, NL2CMD_CONFIG.MAX_QUERY_LENGTH);
}

/**
 * 构建 NL2CMD Prompt
 */
function buildNL2CMDPrompt(request: NL2CMDRequest): string {
  const { os, shell } = detectSystemInfo(request.osType, request.shellType);
  const currentPath = request.currentPath || '~';
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
  prompt: string,
  stream: boolean = false
): Promise<string> {
  const client = getAxiosClient(config.baseUrl, config.apiKey);

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
    temperature: NL2CMD_CONFIG.TEMPERATURE,
    max_completion_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
  };

  if (stream) {
    requestBody.stream = true;
  }

  // 流式响应需要设置 responseType
  if (stream) {
    const streamResponse = await client.post('/v1/chat/completions', requestBody, {
      responseType: 'stream',
    });
    return await parseStreamResponse(streamResponse.data);
  }

  const response = await client.post<OpenAIChatResponse>('/v1/chat/completions', requestBody);
  const choices = response.data?.choices;
  if (!choices || choices.length === 0) {
    throw new Error('OpenAI API 返回空响应');
  }

  const content = choices[0]?.message?.content || '';
  return content.trim();
}

/**
 * 解析流式响应
 * 处理 NodeJS Readable Stream 格式的 SSE 响应
 */
async function parseStreamResponse(data: unknown): Promise<string> {
  const chunks: string[] = [];

  // 处理 NodeJS Stream（axios responseType: 'stream'）
  if (data && typeof data === 'object' && 'on' in data) {
    const stream = data as NodeJS.ReadableStream;
    const buffer: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => buffer.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const fullData = Buffer.concat(buffer).toString('utf-8');
    const lines = fullData.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            chunks.push(content);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  } else if (Buffer.isBuffer(data)) {
    // 兼容测试中的 Buffer 格式
    const lines = data.toString('utf-8').split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const jsonStr = line.slice(6);
        if (jsonStr === '[DONE]') continue;

        try {
          const chunk = JSON.parse(jsonStr);
          const content = chunk.choices?.[0]?.delta?.content;
          if (content) {
            chunks.push(content);
          }
        } catch {
          // 忽略解析错误
        }
      }
    }
  }

  return chunks.join('');
}

/**
 * 调用 OpenAI API (Responses)
 */
async function callOpenAIResponses(config: AIProviderConfig, prompt: string): Promise<string> {
  const client = getAxiosClient(config.baseUrl, config.apiKey);

  const requestBody: OpenAIResponsesRequest = {
    model: config.model,
    input: prompt,
    temperature: NL2CMD_CONFIG.TEMPERATURE,
    max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
  };

  const response = await client.post<OpenAIResponsesResponse>('/v1/responses', requestBody);

  if (!response.data || !response.data.response) {
    throw new Error('OpenAI Responses API 返回空响应');
  }

  const content = response.data.response || '';
  return content.trim();
}

/**
 * 调用 Gemini API
 */
async function callGemini(config: AIProviderConfig, prompt: string): Promise<string> {
  const requestBody: GeminiRequest = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: NL2CMD_CONFIG.TEMPERATURE,
      maxOutputTokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
    },
  };

  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const url = `${baseUrl}/v1beta/models/${config.model}:generateContent`;

  const response = await axios.post<GeminiResponse>(url, requestBody, {
    params: { key: config.apiKey },
    headers: { 'Content-Type': 'application/json' },
    timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS,
  });

  const candidates = response.data?.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Gemini API 返回空响应');
  }

  const content = candidates[0]?.content?.parts?.[0]?.text || '';
  return content.trim();
}

/**
 * 调用 Claude API
 * 注意：Claude API 需要特定的 headers，不能使用共享的 getAxiosClient
 */
async function callClaude(config: AIProviderConfig, prompt: string): Promise<string> {
  const client = axios.create({
    baseURL: config.baseUrl,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS,
  });

  const requestBody: ClaudeRequest = {
    model: config.model,
    max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
    temperature: NL2CMD_CONFIG.TEMPERATURE,
    system: '你是一个专业的命令行助手，专门帮助用户将自然语言转换为精确的命令行指令。',
    messages: [{ role: 'user', content: prompt }],
  };

  const response = await client.post<ClaudeResponse>('/v1/messages', requestBody);

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
  let cleaned = output.replace(/```[\w]*\n?/g, '').replace(/```/g, '');

  // 移除反引号包裹的单行代码
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  cleaned = cleaned.replace(/^\$\s+/, '').replace(/^>\s+/, '');

  cleaned = cleaned.trim();

  const lines = cleaned.split('\n');
  if (lines.length > 1) {
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
 * 构建错误信息
 */
function buildErrorMessage(error: AxiosError): string {
  let errorMessage = '生成命令失败';
  const status = error.response?.status;
  const data = error.response?.data;

  if (error.code === 'ECONNABORTED' && error.config?.timeout) {
    errorMessage = `AI 服务响应超时（${error.config.timeout}ms），请稍后重试或检查网络/Base URL 配置`;
    return errorMessage;
  }

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
        const errorObj = data as { error?: { message?: string }; message?: string } | undefined;
        const errorDetail = errorObj?.error?.message || errorObj?.message || JSON.stringify(data);
        errorMessage = `API 错误 (${status}): ${errorDetail}`;
      } else if (error.request) {
        errorMessage = '无法连接到 AI 服务，请检查网络连接或 Base URL 配置';
      } else {
        errorMessage = error.message || '请求配置错误';
      }
  }

  return errorMessage;
}

/**
 * 生成命令（主函数）
 * 特性：快速失败，不重试
 */
export async function generateCommand(
  request: NL2CMDRequest,
  traceId?: string
): Promise<NL2CMDResponse> {
  const startTime = Date.now();

  try {
    const settings = await getAISettings();

    if (!settings || !settings.enabled) {
      const totalMs = Date.now() - startTime;
      if (shouldLogTiming(totalMs)) {
        console.info('[NL2CMD Timing] Disabled', { traceId, totalMs });
      }
      return { success: false, error: 'AI 功能未启用或未配置' };
    }

    const config: AIProviderConfig = {
      provider: settings.provider,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      openaiEndpoint: settings.openaiEndpoint,
    };

    const prompt = buildNL2CMDPrompt(request);

    if (process.env.NODE_ENV === 'development') {
      console.log('[NL2CMD Debug] Request:', {
        ...request,
        query: request.query.substring(0, 50) + (request.query.length > 50 ? '...' : ''),
      });
      console.log('[NL2CMD Debug] Generated Prompt:', prompt);
    }

    // 调用 AI Provider
    const providerStart = Date.now();
    let rawCommand: string;

    const streamingEnabled = settings.streamingEnabled ?? false;

    switch (config.provider) {
      case 'openai':
        if (config.openaiEndpoint === 'responses') {
          rawCommand = await callOpenAIResponses(config, prompt);
        } else {
          rawCommand = await callOpenAIChatCompletions(config, prompt, streamingEnabled);
        }
        break;
      case 'gemini':
        rawCommand = await callGemini(config, prompt);
        break;
      case 'claude':
        rawCommand = await callClaude(config, prompt);
        break;
      default:
        return { success: false, error: '不支持的 AI Provider' };
    }

    const providerMs = Date.now() - providerStart;

    if (process.env.NODE_ENV === 'development') {
      console.log('[NL2CMD Debug] Raw AI Output:', rawCommand);
    }

    const command = cleanCommandOutput(rawCommand);
    const cleanMs = Date.now() - providerStart;

    if (!command) {
      console.warn('[NL2CMD] Warning: AI returned empty command. Raw output:', rawCommand);
      const totalMs = Date.now() - startTime;
      if (shouldLogTiming(totalMs)) {
        console.info('[NL2CMD Timing] Empty command', {
          traceId,
          totalMs,
          providerMs,
          cleanMs,
          provider: config.provider,
          model: config.model,
          baseUrl: safeBaseUrlForLog(config.baseUrl),
          queryLen: request.query.length,
        });
      }
      return { success: false, error: 'AI 未能生成有效命令，请尝试更详细的描述' };
    }

    if (process.env.NODE_ENV === 'development') {
      console.log('[NL2CMD Debug] Cleaned Command:', command);
    }

    const warning = detectDangerousCommand(command);

    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      console.info('[NL2CMD Timing] Success', {
        traceId,
        totalMs,
        providerMs,
        cleanMs,
        provider: config.provider,
        model: config.model,
        baseUrl: safeBaseUrlForLog(config.baseUrl),
        queryLen: request.query.length,
        hasWarning: Boolean(warning),
        commandLen: command.length,
        streaming: streamingEnabled,
      });
    }

    return {
      success: true,
      command,
      warning,
      streaming: streamingEnabled,
    };
  } catch (error) {
    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      console.warn('[NL2CMD Timing] Failed', {
        traceId,
        totalMs,
        queryLen: request.query.length,
        errorName: (error as Error)?.name,
        errorCode: (error as AxiosError | undefined)?.code,
      });
    }

    console.error('[NL2CMD] 生成命令失败:', error);

    let errorMessage: string;
    if (axios.isAxiosError(error)) {
      errorMessage = buildErrorMessage(error);
    } else if (error instanceof Error) {
      errorMessage = error.message;
    } else {
      errorMessage = '生成命令失败';
    }

    return { success: false, error: errorMessage };
  }
}

/**
 * 测试 AI Provider 连接
 */
export async function testAIConnection(
  config: AIProviderConfig,
  traceId?: string
): Promise<boolean> {
  const startTime = Date.now();

  try {
    const testRequest: NL2CMDRequest = {
      query: '列出当前目录的文件',
      osType: 'Linux',
      shellType: 'bash',
    };

    const prompt = buildNL2CMDPrompt(testRequest);

    const providerStart = Date.now();
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

    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      console.info('[NL2CMD Timing] Test success', {
        traceId,
        totalMs,
        providerMs: Date.now() - providerStart,
        provider: config.provider,
        model: config.model,
        baseUrl: safeBaseUrlForLog(config.baseUrl),
      });
    }

    return true;
  } catch (error) {
    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      console.warn('[NL2CMD Timing] Test failed', {
        traceId,
        totalMs,
        provider: config.provider,
        model: config.model,
        baseUrl: safeBaseUrlForLog(config.baseUrl),
        errorName: (error as Error)?.name,
        errorCode: (error as AxiosError | undefined)?.code,
      });
    }
    console.error('[NL2CMD] 测试连接失败:', error);
    return false;
  }
}

/**
 * 清除 Axios 客户端缓存（用于测试或配置变更时）
 */
export function clearAxiosClientCache(): void {
  axiosClientCache.clear();
}
