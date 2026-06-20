/**
 * AI 智能运维 Store
 * 管理 AI 会话、消息和分析功能
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient, { AI_REQUEST_TIMEOUT_MS } from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { log } from '@/utils/log';
import type {
  AISession,
  AIMessage,
  AIInsight,
  AIQueryResponse,
  AISessionsResponse,
  AISessionDetailsResponse,
  AIHealthSummaryResponse,
  AICommandPatternsResponse,
  AICleanupResponse,
  AIQueryContext,
} from '../types/ai.types';

// AI 调试日志条目
export interface AIDebugLog {
  id: string;
  timestamp: Date;
  type: 'request' | 'response' | 'error';
  source: 'query' | 'nl2cmd';
  data: unknown;
}

export const useAIStore = defineStore('ai', () => {
  // === State ===
  const currentSessionId = ref<string | null>(null);
  const messages = ref<AIMessage[]>([]);
  const sessions = ref<AISession[]>([]);
  const isLoading = ref(false);
  const isTyping = ref(false);
  const error = ref<string | null>(null);
  const insights = ref<AIInsight[]>([]);
  const suggestions = ref<string[]>([]);

  // 独立调试模式（不影响全局日志级别）
  const debugMode = ref(false);
  const debugLogs = ref<AIDebugLog[]>([]);

  // 系统健康摘要缓存
  const healthSummary = ref<AIHealthSummaryResponse['summary'] | null>(null);
  const commandPatterns = ref<AICommandPatternsResponse['analysis'] | null>(null);

  // === Getters ===
  const hasActiveSession = computed(() => currentSessionId.value !== null);
  const currentMessages = computed(() => messages.value);
  const latestInsights = computed(() => insights.value.slice(0, 5));

  // === Actions ===

  /**
   * 发送查询到 AI
   */
  const sendQuery = async (query: string, context?: AIQueryContext): Promise<void> => {
    if (!query.trim()) return;

    error.value = null;
    isTyping.value = true;

    // 先添加用户消息到本地（乐观更新）
    const userMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      sessionId: currentSessionId.value || '',
      role: 'user',
      content: query,
      timestamp: new Date(),
    };
    messages.value.push(userMsg);

    // 调试模式：记录请求
    if (debugMode.value) {
      const reqEntry: AIDebugLog = {
        id: `dbg-${Date.now()}-req`,
        timestamp: new Date(),
        type: 'request',
        source: 'query',
        data: { query, sessionId: currentSessionId.value, context },
      };
      debugLogs.value.push(reqEntry);
      log.debug(`[AI Debug] Request: ${query.substring(0, 50)}...`, reqEntry.data);
    }

    try {
      const response = await apiClient.post<AIQueryResponse>(
        '/ai/query',
        {
          query,
          ...(currentSessionId.value && { sessionId: currentSessionId.value }),
          context,
          debug: debugMode.value || undefined,
        },
        { timeout: AI_REQUEST_TIMEOUT_MS },
      );

      // 调试模式：记录响应
      if (debugMode.value) {
        const resEntry: AIDebugLog = {
          id: `dbg-${Date.now()}-res`,
          timestamp: new Date(),
          type: 'response',
          source: 'query',
          data: response.data,
        };
        debugLogs.value.push(resEntry);
        log.debug(`[AI Debug] Response (success: ${response.data.success})`, {
          sessionId: response.data.sessionId,
          message: response.data.message,
          insights: response.data.insights,
          suggestions: response.data.suggestions,
          fullResponse: response.data,
        });
      }

      if (response.data.success) {
        // 更新会话 ID
        currentSessionId.value = response.data.sessionId;

        // 更新用户消息的 sessionId
        userMsg.sessionId = response.data.sessionId;

        // 添加 AI 响应消息
        const aiMessage: AIMessage = {
          ...response.data.message,
          timestamp: new Date(response.data.message.timestamp),
        };
        messages.value.push(aiMessage);

        // 更新洞察和建议
        insights.value = response.data.insights || [];
        suggestions.value = response.data.suggestions || [];
      } else {
        throw new Error('查询失败');
      }
    } catch (err: unknown) {
      log.error('[AIStore] 发送查询失败:', err);
      error.value = extractErrorMessage(err, '发送查询失败');

      // 调试模式：记录错误
      if (debugMode.value) {
        const errEntry: AIDebugLog = {
          id: `dbg-${Date.now()}-err`,
          timestamp: new Date(),
          type: 'error',
          source: 'query',
          data: { message: extractErrorMessage(err, '发送查询失败'), raw: err },
        };
        debugLogs.value.push(errEntry);
        log.error('[AI Debug] Error', errEntry.data);
      }

      // 移除乐观更新的消息
      messages.value = messages.value.filter((m) => m.id !== userMsg.id);
    } finally {
      isTyping.value = false;
    }
  };

  /**
   * 获取用户会话列表
   */
  const fetchSessions = async (limit = 50, offset = 0): Promise<void> => {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<AISessionsResponse>('/ai/sessions', {
        params: { limit, offset },
      });

      if (response.data.success) {
        sessions.value = response.data.sessions.map((s) => ({
          ...s,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
          messages:
            s.messages?.map((m) => ({
              ...m,
              timestamp: new Date(m.timestamp),
            })) || [],
        }));
      }
    } catch (err: unknown) {
      log.error('[AIStore] 获取会话列表失败:', err);
      error.value = extractErrorMessage(err, '获取会话列表失败');
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 加载指定会话详情
   */
  const loadSession = async (sessionId: string): Promise<void> => {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<AISessionDetailsResponse>(`/ai/sessions/${sessionId}`);

      if (response.data.success) {
        currentSessionId.value = sessionId;
        messages.value = response.data.session.messages.map((m) => ({
          ...m,
          timestamp: new Date(m.timestamp),
        }));
      }
    } catch (err: unknown) {
      log.error('[AIStore] 加载会话详情失败:', err);
      error.value = extractErrorMessage(err, '加载会话详情失败');
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 删除会话
   */
  const deleteSession = async (sessionId: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/ai/sessions/${sessionId}`);

      // 从本地列表移除
      sessions.value = sessions.value.filter((s) => s.sessionId !== sessionId);

      // 如果删除的是当前会话，清空状态
      if (currentSessionId.value === sessionId) {
        currentSessionId.value = null;
        messages.value = [];
      }

      return true;
    } catch (err: unknown) {
      log.error('[AIStore] 删除会话失败:', err);
      error.value = extractErrorMessage(err, '删除会话失败');
      return false;
    }
  };

  /**
   * 开始新会话
   */
  const startNewSession = (): void => {
    currentSessionId.value = null;
    messages.value = [];
    insights.value = [];
    suggestions.value = [];
    error.value = null;
  };

  /**
   * 获取系统健康摘要
   */
  const fetchHealthSummary = async (): Promise<void> => {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<AIHealthSummaryResponse>('/ai/health');

      if (response.data.success) {
        healthSummary.value = response.data.summary;
        // 更新洞察
        if (response.data.summary.recentAlerts) {
          insights.value = response.data.summary.recentAlerts.map((a) => ({
            ...a,
            timestamp: new Date(a.timestamp),
          }));
        }
      }
    } catch (err: unknown) {
      log.error('[AIStore] 获取健康摘要失败:', err);
      error.value = extractErrorMessage(err, '获取健康摘要失败');
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 获取命令模式分析
   */
  const fetchCommandPatterns = async (): Promise<void> => {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<AICommandPatternsResponse>('/ai/patterns');

      if (response.data.success) {
        commandPatterns.value = response.data.analysis;
      }
    } catch (err: unknown) {
      log.error('[AIStore] 获取命令模式分析失败:', err);
      error.value = extractErrorMessage(err, '获取命令模式分析失败');
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 清理旧会话
   */
  const cleanupSessions = async (keepCount = 50): Promise<number> => {
    try {
      const response = await apiClient.post<AICleanupResponse>('/ai/cleanup', {
        keepCount,
      });

      if (response.data.success) {
        // 刷新会话列表
        await fetchSessions();
        return response.data.deletedCount;
      }
      return 0;
    } catch (err: unknown) {
      log.error('[AIStore] 清理会话失败:', err);
      error.value = extractErrorMessage(err, '清理会话失败');
      return 0;
    }
  };

  /**
   * 清除错误
   */
  const clearError = (): void => {
    error.value = null;
  };

  // === 调试模式 Actions ===

  /**
   * 切换调试模式
   */
  const toggleDebugMode = (): void => {
    debugMode.value = !debugMode.value;
    if (debugMode.value) {
      log.info('[AIStore] 调试模式已开启');
    } else {
      log.info('[AIStore] 调试模式已关闭');
    }
  };

  /**
   * 清除调试日志
   */
  const clearDebugLogs = (): void => {
    debugLogs.value = [];
  };

  /**
   * 添加调试日志（供 NL2CMD 等外部模块使用）
   */
  const addDebugLog = (entry: Omit<AIDebugLog, 'id' | 'timestamp'>): void => {
    if (!debugMode.value) return;
    const fullEntry: AIDebugLog = {
      ...entry,
      id: `dbg-${Date.now()}-${entry.source}`,
      timestamp: new Date(),
    };
    debugLogs.value.push(fullEntry);
  };

  return {
    // State
    currentSessionId,
    messages,
    sessions,
    isLoading,
    isTyping,
    error,
    insights,
    suggestions,
    healthSummary,
    commandPatterns,
    debugMode,
    debugLogs,

    // Getters
    hasActiveSession,
    currentMessages,
    latestInsights,

    // Actions
    sendQuery,
    fetchSessions,
    loadSession,
    deleteSession,
    startNewSession,
    fetchHealthSummary,
    fetchCommandPatterns,
    cleanupSessions,
    clearError,
    toggleDebugMode,
    clearDebugLogs,
    addDebugLog,
  };
});
