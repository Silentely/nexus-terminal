/**
 * NL2CMD (Natural Language to Command) Service
 * 负责与各个 AI Provider 通信，将自然语言转换为命令行指令
 *
 * 优化特性：
 * - Axios 客户端单例复用
 * - 流式响应支持
 * - 429 限流指数退避重试
 */

import axios, { AxiosInstance, AxiosError } from 'axios';
import http from 'http';
import https from 'https';
import {
  AIProviderConfig,
  NL2CMDRequest,
  NL2CMDResponse,
  OpenAIChatRequest,
  OpenAIChatResponse,
  OpenAIResponsesRequest,
  OpenAIResponsesResponse,
  ClaudeRequest,
  ClaudeResponse,
  AISettings,
} from './nl2cmd.types';
import { NL2CMD_CONFIG, safeBaseUrlForLog, shouldLogTiming } from './nl2cmd.constants';
import { settingsRepository } from '../settings/settings.repository';
import crypto from 'crypto';
import { encrypt, decrypt } from '../utils/crypto';
import { ErrorFactory } from '../utils/AppError';
import { logger } from '../utils/logger';
import { resolveAndValidatePublicHost } from '../utils/url';
import { createPinnedLookup } from '../utils/ssrf-guard';

const AI_SETTINGS_KEY = 'aiProviderConfig';

/**
 * 获取 DNS 绑定的 Agent（带缓存）
 * 对同一 baseURL 复用 Agent 实例，避免重复创建
 */
const pinnedAgentCache = new Map<string, { httpAgent: http.Agent; httpsAgent: https.Agent }>();

function getPinnedAgents(
  baseUrl: string,
  addresses: string[],
): { httpAgent: http.Agent; httpsAgent: https.Agent } {
  const cached = pinnedAgentCache.get(baseUrl);
  if (cached) return cached;

  const lookup = createPinnedLookup(addresses);
  const agents = {
    httpAgent: new http.Agent({ lookup }),
    httpsAgent: new https.Agent({ lookup }),
  };
  pinnedAgentCache.set(baseUrl, agents);
  return agents;
}

/**
 * Provider 调用结果（含 token 用量）
 */
interface ProviderResult {
  command: string;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  };
}

/**
 * Axios 客户端缓存（按 baseUrl + apiKey 缓存，带 LRU 淘汰）
 * 上限 16 个客户端，超出时淘汰最早的条目
 */
const axiosClientCache = new Map<string, AxiosInstance>();
const AXIOS_CACHE_MAX_SIZE = 16;

/**
 * 获取或创建 Axios 客户端（单例复用）
 */
function getCacheKey(baseUrl: string, apiKey: string, prefix?: string): string {
  // 使用完整 apiKey 的 hex digest 避免前缀碰撞
  const keyHash = crypto.createHash('sha256').update(apiKey).digest('hex').slice(0, 16);
  return prefix ? `${prefix}:${baseUrl}::${keyHash}` : `${baseUrl}::${keyHash}`;
}

async function getAxiosClient(baseUrl: string, apiKey: string): Promise<AxiosInstance> {
  const cacheKey = getCacheKey(baseUrl, apiKey);

  let client = axiosClientCache.get(cacheKey);
  if (!client) {
    // SSRF 防护：验证 baseURL 并获取已解析的 IP 地址
    const { addresses } = await resolveAndValidatePublicHost(baseUrl, 'NL2CMD');
    const { httpAgent, httpsAgent } = getPinnedAgents(baseUrl, addresses);

    client = axios.create({
      baseURL: baseUrl,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS,
      httpAgent,
      httpsAgent,
      proxy: false,
    });
  }
  // LRU：命中时刷新访问顺序，未命中时创建后插入
  axiosClientCache.delete(cacheKey);
  axiosClientCache.set(cacheKey, client);
  // 容量超限时淘汰最早的条目
  if (axiosClientCache.size > AXIOS_CACHE_MAX_SIZE) {
    const oldestKey = axiosClientCache.keys().next().value;
    if (oldestKey) axiosClientCache.delete(oldestKey);
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

    // 确保 enabled 是 boolean 类型
    if (config) {
      config.enabled = !!config.enabled;
    }

    // 解密 API Key
    if (config.apiKey) {
      try {
        config.apiKey = decrypt(config.apiKey);
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
        logger.warn('[NL2CMD] API Key 解密失败，可能是旧格式明文存储');
      }
    }
    return config;
  } catch (error: unknown) {
    logger.error('[NL2CMD] 获取 AI 配置失败:', error);
    throw ErrorFactory.serviceUnavailable('获取 AI 配置失败，请稍后重试');
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
  } catch (error: unknown) {
    logger.error('[NL2CMD] 保存 AI 配置失败:', error);
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
 * 清理用户输入，防止 Prompt 注入和 Unicode 同形字攻击
 */
function sanitizeUserInput(input: string): string {
  return (
    input
      // NFKC 标准化：将全角字符、组合字符等统一为等效 ASCII 形式
      .normalize('NFKC')
      // 剥离零宽字符和不可见格式字符（U+200B-U+200F, U+2028-U+202F, U+FEFF）
      .replace(/[\u200B-\u200F\u2028-\u202F\uFEFF]/g, '')
      .replace(/[\r\n]+/g, ' ')
      .replace(/```/g, '')
      .replace(/\${/g, '')
      .trim()
      .slice(0, NL2CMD_CONFIG.MAX_QUERY_LENGTH)
  );
}

/**
 * 构建 NL2CMD Prompt
 */
function buildNL2CMDPrompt(request: NL2CMDRequest): string {
  const { os, shell } = detectSystemInfo(request.osType, request.shellType);
  const currentPath = request.currentPath || '~';
  const sanitizedQuery = sanitizeUserInput(request.query);

  return `系统信息：
- 操作系统：${os}
- Shell 类型：${shell}
- 当前路径：${currentPath}

要求：
1. 只返回命令本身，不要添加任何解释或额外文本
2. 不要使用 Markdown 代码块格式（不要用 \`\`\`）
3. 如果需要多条命令，使用 && 或 ; 连接
4. 确保命令语法适配指定的操作系统和 Shell 类型
5. 对于危险操作（如 rm -rf），添加 --interactive 或 -i 等安全选项
6. 以 JSON 格式返回：{"command": "命令内容"}

用户描述：${sanitizedQuery}

请以 JSON 格式返回：{"command": "命令内容"}`;
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
  stream: boolean = false,
  endpointPath: string = '/chat/completions',
): Promise<ProviderResult> {
  const client = await getAxiosClient(config.baseUrl, config.apiKey);

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
    max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
  };

  if (stream) {
    requestBody.stream = true;
    requestBody.stream_options = { include_usage: true };
  }

  const postChatCompletions = async (body: OpenAIChatRequest): Promise<ProviderResult> => {
    // 流式响应需要设置 responseType
    if (stream) {
      const streamResponse = await client.post(endpointPath, body, {
        responseType: 'stream',
      });
      return { command: await parseStreamResponse(streamResponse.data) };
    }

    const response = await client.post<OpenAIChatResponse>(endpointPath, body);
    const choices = response.data?.choices;
    if (!choices || choices.length === 0) {
      logger.warn(
        '[NL2CMD] OpenAI API 返回空 choices，响应体:',
        JSON.stringify(response.data).slice(0, 500),
      );
      throw new Error('OpenAI API 返回空响应');
    }

    const content = choices[0]?.message?.content || '';
    return {
      command: content.trim(),
      usage: response.data?.usage,
    };
  };

  return retryWithBackoff(() => postChatCompletions(requestBody));
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
        } catch (error: unknown) {
          // SSE 数据块解析失败，跳过继续处理后续数据
          logger.debug('[NL2CMD] SSE 数据块解析失败:', error);
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
        } catch (error: unknown) {
          // SSE 数据块解析失败，跳过继续处理后续数据
          logger.debug('[NL2CMD] Buffer 数据块解析失败:', error);
        }
      }
    }
  }

  return chunks.join('');
}

/**
 * 流式解析 SSE 响应，通过回调逐块返回
 * 用于真 streaming 场景
 */
async function parseStreamResponseWithCallback(
  data: unknown,
  onChunk: (chunk: string) => void,
): Promise<string> {
  const chunks: string[] = [];

  const processLine = (line: string) => {
    if (line.startsWith('data: ')) {
      const jsonStr = line.slice(6);
      if (jsonStr === '[DONE]') return;
      try {
        const parsed = JSON.parse(jsonStr);
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) {
          chunks.push(content);
          onChunk(content);
        }
      } catch (err: unknown) {
        logger.debug({ err }, '操作失败，已忽略');
        logger.debug('[NL2CMD] SSE streaming 数据块解析失败');
      }
    }
  };

  if (data && typeof data === 'object' && 'on' in data) {
    const stream = data as NodeJS.ReadableStream;
    const decoder = new (require('string_decoder').StringDecoder)('utf-8');
    let partial = '';
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => {
        partial += decoder.write(chunk);
        const lines = partial.split('\n');
        partial = lines.pop() || '';
        for (const line of lines) processLine(line.trim());
      });
      stream.on('end', () => {
        if (partial) processLine(partial.trim());
        resolve();
      });
      stream.on('error', reject);
    });
  } else if (Buffer.isBuffer(data)) {
    for (const line of data.toString('utf-8').split('\n')) processLine(line.trim());
  }

  return chunks.join('');
}

/**
 * 生成命令（流式版本）
 * 通过回调逐块返回 AI 生成的内容
 */
export async function generateCommandStream(
  request: NL2CMDRequest,
  onChunk: (chunk: string) => void,
  traceId?: string,
  signal?: AbortSignal,
): Promise<NL2CMDResponse> {
  const startTime = Date.now();
  try {
    const settings = await getAISettings();
    if (!settings || !settings.enabled) {
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
    let providerResult: ProviderResult;
    const providerStart = Date.now();

    if (config.provider === 'openai' && !(config.openaiEndpoint || '').includes('responses')) {
      // 真 streaming：OpenAI Chat Completions
      const client = await getAxiosClient(config.baseUrl, config.apiKey);
      const requestBody: OpenAIChatRequest = {
        model: config.model,
        messages: [
          {
            role: 'developer',
            content: '你是一个专业的命令行助手，专门帮助用户将自然语言转换为精确的命令行指令。',
          },
          { role: 'user', content: prompt },
        ],
        temperature: NL2CMD_CONFIG.TEMPERATURE,
        max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
        stream: true,
        stream_options: { include_usage: true },
      };
      const endpointPath = (() => {
        const ep = config.openaiEndpoint || '/chat/completions';
        const normalizedEp = ep.startsWith('/') ? ep : `/${ep}`;
        return `${config.baseUrl.replace(/\/$/, '')}${normalizedEp}`;
      })();
      const streamResponse = await retryWithBackoff(() =>
        client.post(endpointPath, requestBody, {
          responseType: 'stream',
          signal,
        }),
      );
      const command = await parseStreamResponseWithCallback(streamResponse.data, onChunk);
      providerResult = { command };
    } else {
      // 非 streaming provider：缓冲完整响应
      switch (config.provider) {
        case 'openai':
          providerResult = await callOpenAIResponses(config, prompt);
          break;
        case 'claude':
          providerResult = await callClaude(config, prompt);
          break;
        default:
          return { success: false, error: '不支持的 AI Provider' };
      }
      onChunk(providerResult.command);
    }

    const rawCommand = providerResult.command;
    const providerMs = Date.now() - providerStart;
    const command = cleanCommandOutput(rawCommand);
    if (!command) return { success: false, error: 'AI 未能生成有效命令，请尝试更详细的描述' };
    const warning = detectDangerousCommand(command);
    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      logger.info('[NL2CMD Timing] Stream Success', {
        traceId,
        totalMs,
        providerMs,
        provider: config.provider,
        model: config.model,
        baseUrl: safeBaseUrlForLog(config.baseUrl),
        queryLen: request.query.length,
        commandLen: command.length,
        streaming: true,
        ...(providerResult.usage ? { usage: providerResult.usage } : {}),
      });
    }
    return { success: true, command, warning };
  } catch (error: unknown) {
    const totalMs = Date.now() - startTime;
    if (axios.isAxiosError(error)) {
      const errorMessage = buildErrorMessage(error);
      if (shouldLogTiming(totalMs)) {
        logger.warn('[NL2CMD Timing] Stream Failed', { traceId, totalMs, error: errorMessage });
      }
      return { success: false, error: errorMessage };
    }
    if (shouldLogTiming(totalMs)) {
      logger.warn('[NL2CMD Timing] Stream Failed', { traceId, totalMs, error: String(error) });
    }
    return { success: false, error: '生成命令失败' };
  }
}

/**
 * 调用 OpenAI API (Responses)
 */
async function callOpenAIResponses(
  config: AIProviderConfig,
  prompt: string,
  endpointPath: string = '/responses',
): Promise<ProviderResult> {
  const client = await getAxiosClient(config.baseUrl, config.apiKey);

  const requestBody: OpenAIResponsesRequest = {
    model: config.model,
    input: prompt,
    temperature: NL2CMD_CONFIG.TEMPERATURE,
    max_output_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
  };

  return retryWithBackoff(async () => {
    const response = await client.post<OpenAIResponsesResponse>(endpointPath, requestBody);
    const data = response.data;

    if (!data) {
      throw new Error('OpenAI Responses API 返回空响应');
    }

    // 从 output 数组提取文本（兼容 response 字段回退）
    let content = '';
    if (data.output && Array.isArray(data.output)) {
      for (const item of data.output) {
        if (item.type === 'message' && item.content) {
          for (const part of item.content) {
            if (part.type === 'output_text' && part.text) {
              content = part.text;
              break;
            }
          }
        }
        if (content) break;
      }
    }
    // 兼容旧版：尝试 response 字段
    if (!content) {
      content = data.response || '';
    }
    if (!content) {
      throw new Error('OpenAI Responses API 返回空响应');
    }

    return {
      command: content.trim(),
      usage: data.usage,
    };
  });
}

const MAX_RETRY_ATTEMPTS = 2;
const RETRY_BASE_DELAY_MS = 1000;

/**
 * 429 限流重试包装器，指数退避
 * 仅对 429 状态码重试，其他错误立即抛出
 */
async function retryWithBackoff<T>(fn: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      if (
        attempt < MAX_RETRY_ATTEMPTS &&
        axios.isAxiosError(error) &&
        error.response?.status === 429
      ) {
        const delay = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
        logger.warn(`[NL2CMD] 429 限流，${delay}ms 后重试 (${attempt + 1}/${MAX_RETRY_ATTEMPTS})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * 调用 Claude API
 * 注意：Claude API 需要特定的 headers，不能使用共享的 getAxiosClient
 */
async function getClaudeClient(config: AIProviderConfig): Promise<AxiosInstance> {
  // 兼容旧版 baseUrl（不含 /v1）：自动补全
  const normalizedBaseUrl =
    config.baseUrl.replace(/\/$/, '') + (config.baseUrl.includes('/v1') ? '' : '/v1');
  const cacheKey = getCacheKey(normalizedBaseUrl, config.apiKey, 'claude');
  let client = axiosClientCache.get(cacheKey);
  if (client) {
    // LRU：命中时刷新访问顺序
    axiosClientCache.delete(cacheKey);
    axiosClientCache.set(cacheKey, client);
    return client;
  }
  // SSRF 防护：验证 baseURL 并获取已解析的 IP 地址
  const { addresses } = await resolveAndValidatePublicHost(normalizedBaseUrl, 'NL2CMD-Claude');
  const { httpAgent, httpsAgent } = getPinnedAgents(normalizedBaseUrl, addresses);

  client = axios.create({
    baseURL: normalizedBaseUrl,
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    timeout: NL2CMD_CONFIG.REQUEST_TIMEOUT_MS,
    httpAgent,
    httpsAgent,
    proxy: false,
  });
  if (axiosClientCache.size >= AXIOS_CACHE_MAX_SIZE) {
    const firstKey = axiosClientCache.keys().next().value;
    if (firstKey) axiosClientCache.delete(firstKey);
  }
  axiosClientCache.set(cacheKey, client);
  return client;
}

async function callClaude(config: AIProviderConfig, prompt: string): Promise<ProviderResult> {
  const client = await getClaudeClient(config);

  const requestBody: ClaudeRequest = {
    model: config.model,
    max_tokens: NL2CMD_CONFIG.MAX_OUTPUT_TOKENS,
    temperature: NL2CMD_CONFIG.TEMPERATURE,
    system: '你是一个专业的命令行助手，专门帮助用户将自然语言转换为精确的命令行指令。',
    messages: [{ role: 'user', content: prompt }],
  };

  return retryWithBackoff(async () => {
    const response = await client.post<ClaudeResponse>('/messages', requestBody);

    const contentArray = response.data?.content;
    if (!contentArray || contentArray.length === 0) {
      throw new Error('Claude API 返回空响应');
    }

    const content = contentArray[0]?.text || '';
    return {
      command: content.trim(),
      usage: response.data?.usage,
    };
  });
}

/**
 * 清理 AI 返回的命令（优先解析 JSON，回退到正则清理）
 */
function cleanCommandOutput(output: string): string {
  // 先剥离 Markdown 代码块围栏，再尝试 JSON 解析
  let cleaned = output
    .replace(/```[\w]*\n?/g, '')
    .replace(/```/g, '')
    .trim();

  // 优先尝试解析 JSON 格式响应
  try {
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed.command === 'string' && parsed.command.trim()) {
      return parsed.command.trim();
    }
  } catch (err: unknown) {
    logger.debug({ err }, '操作失败，已忽略');
    // 非 JSON 响应，继续使用正则清理
  }

  // 移除反引号包裹的单行代码
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

  cleaned = cleaned.replace(/^\$\s+/, '').replace(/^>\s+/, '');

  cleaned = cleaned.trim();

  const lines = cleaned.split('\n');
  if (lines.length > 1) {
    for (const line of lines) {
      const lineTrimmed = line.trim();
      if (lineTrimmed && !lineTrimmed.startsWith('#') && !lineTrimmed.startsWith('//')) {
        return lineTrimmed;
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
      logger.warn('[NL2CMD] Upstream 429 Error Details:', {
        url: error.config?.url,
        baseURL: error.config?.baseURL,
        status,
        data,
      });
      errorMessage = 'API 请求频率超限或配额已耗尽，请稍后再试';
      const rateLimitErrorObj =
        typeof data === 'object' && data !== null
          ? (data as { error?: { message?: unknown } })
          : undefined;
      if (typeof rateLimitErrorObj?.error?.message === 'string') {
        errorMessage += `: ${rateLimitErrorObj.error.message}`;
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
 * 特性：429 限流自动重试（指数退避）
 */
export async function generateCommand(
  request: NL2CMDRequest,
  traceId?: string,
): Promise<NL2CMDResponse> {
  const startTime = Date.now();

  try {
    const settings = await getAISettings();

    if (!settings || !settings.enabled) {
      const totalMs = Date.now() - startTime;
      if (shouldLogTiming(totalMs)) {
        logger.info('[NL2CMD Timing] Disabled', { traceId, totalMs });
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

    if (process.env.NODE_ENV === 'development' || request.debug) {
      logger.debug('[NL2CMD Debug] Request:', {
        ...request,
        query: request.query.substring(0, 50) + (request.query.length > 50 ? '...' : ''),
      });
      logger.debug('[NL2CMD Debug] Generated Prompt:', prompt);
    }

    // 调用 AI Provider
    const providerStart = Date.now();
    let providerResult: ProviderResult;

    const endpointPath = (() => {
      const ep = config.openaiEndpoint || '/chat/completions';
      const normalizedEp = ep.startsWith('/') ? ep : `/${ep}`;
      return `${config.baseUrl.replace(/\/$/, '')}${normalizedEp}`;
    })();
    switch (config.provider) {
      case 'openai':
        if (endpointPath.includes('responses')) {
          providerResult = await callOpenAIResponses(config, prompt, endpointPath);
        } else {
          providerResult = await callOpenAIChatCompletions(config, prompt, false, endpointPath);
        }
        break;
      case 'claude':
        providerResult = await callClaude(config, prompt);
        break;
      default:
        return { success: false, error: '不支持的 AI Provider' };
    }

    const rawCommand = providerResult.command;

    const providerMs = Date.now() - providerStart;

    if (process.env.NODE_ENV === 'development' || request.debug) {
      logger.debug('[NL2CMD Debug] Raw AI Output:', rawCommand);
    }

    const command = cleanCommandOutput(rawCommand);
    const cleanMs = Date.now() - providerStart;

    if (!command) {
      logger.warn('[NL2CMD] Warning: AI returned empty command. Raw output:', rawCommand);
      const totalMs = Date.now() - startTime;
      if (shouldLogTiming(totalMs)) {
        logger.info('[NL2CMD Timing] Empty command', {
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

    if (process.env.NODE_ENV === 'development' || request.debug) {
      logger.debug('[NL2CMD Debug] Cleaned Command:', command);
    }

    const warning = detectDangerousCommand(command);

    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      logger.info('[NL2CMD Timing] Success', {
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
        ...(providerResult.usage ? { usage: providerResult.usage } : {}),
      });
    }

    return {
      success: true,
      command,
      warning,
    };
  } catch (error: unknown) {
    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      logger.warn('[NL2CMD Timing] Failed', {
        traceId,
        totalMs,
        queryLen: request.query.length,
        errorName: (error as Error)?.name,
        errorCode: (error as AxiosError | undefined)?.code,
      });
    }

    logger.error('[NL2CMD] 生成命令失败:', error);

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
  traceId?: string,
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
    const endpointPath = (() => {
      const ep = config.openaiEndpoint || '/chat/completions';
      const normalizedEp = ep.startsWith('/') ? ep : `/${ep}`;
      return `${config.baseUrl.replace(/\/$/, '')}${normalizedEp}`;
    })();
    switch (config.provider) {
      case 'openai':
        if (endpointPath.includes('responses')) {
          await callOpenAIResponses(config, prompt, endpointPath);
        } else {
          await callOpenAIChatCompletions(config, prompt, false, endpointPath);
        }
        break;
      case 'claude':
        await callClaude(config, prompt);
        break;
      default:
        return false;
    }

    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      logger.info('[NL2CMD Timing] Test success', {
        traceId,
        totalMs,
        providerMs: Date.now() - providerStart,
        provider: config.provider,
        model: config.model,
        baseUrl: safeBaseUrlForLog(config.baseUrl),
      });
    }

    return true;
  } catch (error: unknown) {
    const totalMs = Date.now() - startTime;
    if (shouldLogTiming(totalMs)) {
      logger.warn('[NL2CMD Timing] Test failed', {
        traceId,
        totalMs,
        provider: config.provider,
        model: config.model,
        baseUrl: safeBaseUrlForLog(config.baseUrl),
        errorName: (error as Error)?.name,
        errorCode: (error as AxiosError | undefined)?.code,
      });
    }
    logger.error('[NL2CMD] 测试连接失败:', error);
    return false;
  }
}

/**
 * 清除 Axios 客户端缓存（用于测试或配置变更时）
 */
export function clearAxiosClientCache(): void {
  axiosClientCache.clear();
}
