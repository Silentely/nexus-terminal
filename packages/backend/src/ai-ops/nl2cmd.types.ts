/**
 * NL2CMD (Natural Language to Command) 类型定义
 * 支持将自然语言转换为命令行指令
 */

// AI Provider 类型
export type AIProvider = 'openai' | 'gemini' | 'claude';

// OpenAI API 端点类型
export type OpenAIEndpoint = 'chat/completions' | 'responses';

// AI Provider 配置
export interface AIProviderConfig {
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  // OpenAI 特有配置
  openaiEndpoint?: OpenAIEndpoint;
}

// NL2CMD 请求
export interface NL2CMDRequest {
  query: string; // 自然语言描述
  osType?: string; // 操作系统类型 (Ubuntu, CentOS, macOS, Windows 等)
  shellType?: string; // Shell 类型 (bash, zsh, fish, pwsh 等)
  currentPath?: string; // 当前工作目录
}

// NL2CMD 响应
export interface NL2CMDResponse {
  success: boolean;
  command?: string; // 生成的命令
  explanation?: string; // 命令解释
  warning?: string; // 警告信息（对于危险命令）
  error?: string; // 错误信息
}

// OpenAI Chat Completions API 请求
export interface OpenAIChatRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
  max_tokens?: number;
}

// OpenAI Chat Completions API 响应
export interface OpenAIChatResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// OpenAI Responses API 请求
export interface OpenAIResponsesRequest {
  model: string;
  input: string;
  temperature?: number;
  max_tokens?: number;
}

// OpenAI Responses API 响应
export interface OpenAIResponsesResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  response: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

// Gemini API 请求
export interface GeminiRequest {
  contents: Array<{
    role?: string;
    parts: Array<{
      text: string;
    }>;
  }>;
  generationConfig?: {
    temperature?: number;
    maxOutputTokens?: number;
  };
}

// Gemini API 响应
export interface GeminiResponse {
  candidates: Array<{
    content: {
      parts: Array<{
        text: string;
      }>;
      role: string;
    };
    finishReason: string;
    index: number;
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}

// Claude API 请求
export interface ClaudeRequest {
  model: string;
  messages: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  max_tokens: number;
  temperature?: number;
  system?: string;
}

// Claude API 响应
export interface ClaudeResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{
    type: string;
    text: string;
  }>;
  model: string;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

// AI Provider 设置（存储在数据库中）
export interface AISettings {
  enabled: boolean;
  provider: AIProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  openaiEndpoint?: OpenAIEndpoint;
  rateLimitEnabled?: boolean; // 是否启用速率限制（默认 true）
}
