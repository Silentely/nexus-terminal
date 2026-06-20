import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useAIStore } from './ai.store';
import apiClient from '../utils/apiClient';
import type {
  AIMessage,
  AISession,
  AIInsight,
  AIQueryResponse,
  AISessionsResponse,
  AISessionDetailsResponse,
  AIHealthSummaryResponse,
  AICommandPatternsResponse,
  AICleanupResponse,
} from '../types/ai.types';

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
  AI_REQUEST_TIMEOUT_MS: 30000,
}));

describe('ai.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useAIStore();

      expect(store.currentSessionId).toBeNull();
      expect(store.messages).toEqual([]);
      expect(store.sessions).toEqual([]);
      expect(store.isLoading).toBe(false);
      expect(store.isTyping).toBe(false);
      expect(store.error).toBeNull();
      expect(store.insights).toEqual([]);
      expect(store.suggestions).toEqual([]);
      expect(store.healthSummary).toBeNull();
      expect(store.commandPatterns).toBeNull();
    });
  });

  describe('Getters', () => {
    it('hasActiveSession 应在有会话 ID 时返回 true', () => {
      const store = useAIStore();
      store.currentSessionId = 'session-123';

      expect(store.hasActiveSession).toBe(true);
    });

    it('currentMessages 应返回消息列表', () => {
      const store = useAIStore();
      const mockMessages: AIMessage[] = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: '你好',
          timestamp: new Date(),
        },
      ];
      store.messages = mockMessages;

      expect(store.currentMessages).toEqual(mockMessages);
    });

    it('latestInsights 应返回最多 5 条洞察', () => {
      const store = useAIStore();
      const mockInsights: AIInsight[] = Array.from({ length: 10 }, (_, i) => ({
        type: 'recommendation' as const,
        severity: 'info' as const,
        title: `Insight ${i}`,
        description: 'Test',
        actionable: false,
        timestamp: new Date(),
      }));
      store.insights = mockInsights;

      expect(store.latestInsights).toHaveLength(5);
    });
  });

  describe('sendQuery', () => {
    it('发送查询成功应更新消息和会话 ID', async () => {
      const store = useAIStore();

      const mockResponse: AIQueryResponse = {
        success: true,
        sessionId: 'session-123',
        message: {
          id: 'msg-2',
          sessionId: 'session-123',
          role: 'assistant',
          content: 'AI 回复',
          timestamp: new Date(),
        },
        insights: [],
        suggestions: ['建议 1', '建议 2'],
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: mockResponse });

      await store.sendQuery('测试查询');

      expect(store.currentSessionId).toBe('session-123');
      expect(store.messages).toHaveLength(2); // 用户消息 + AI 消息
      expect(store.messages[0].content).toBe('测试查询');
      expect(store.messages[0].role).toBe('user');
      expect(store.messages[1].content).toBe('AI 回复');
      expect(store.messages[1].role).toBe('assistant');
      expect(store.suggestions).toEqual(['建议 1', '建议 2']);
    });

    it('发送查询失败应回滚乐观更新', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '查询失败' } },
      });

      await store.sendQuery('测试查询');

      expect(store.messages).toEqual([]); // 应该被移除
      expect(store.error).toBe('查询失败');
    });

    it('空查询应被忽略', async () => {
      const store = useAIStore();

      await store.sendQuery('   ');

      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('带上下文的查询应传递 context', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          success: true,
          sessionId: 'session-123',
          message: {
            id: 'msg-1',
            sessionId: 'session-123',
            role: 'assistant',
            content: 'Response',
            timestamp: new Date(),
          },
          insights: [],
          suggestions: [],
        },
      });

      await store.sendQuery('查询', { connectionIds: [1, 2], currentPath: '/home' });

      expect(apiClient.post).toHaveBeenCalledWith(
        '/ai/query',
        expect.objectContaining({
          query: '查询',
          context: { connectionIds: [1, 2], currentPath: '/home' },
        }),
        { timeout: 30000 },
      );
    });
  });

  describe('fetchSessions', () => {
    it('应获取会话列表并转换日期', async () => {
      const store = useAIStore();

      const mockSessions: AISession[] = [
        {
          sessionId: 'session-1',
          userId: 1,
          title: '会话标题',
          messages: [
            {
              id: 'msg-1',
              sessionId: 'session-1',
              role: 'user',
              content: 'Hello',
              timestamp: new Date('2023-01-01'),
            },
          ],
          createdAt: new Date('2023-01-01'),
          updatedAt: new Date('2023-01-02'),
        },
      ];

      const mockResponse: AISessionsResponse = {
        success: true,
        sessions: mockSessions as any,
        limit: 50,
        offset: 0,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockResponse });

      await store.fetchSessions();

      expect(store.sessions).toHaveLength(1);
      expect(store.sessions[0].sessionId).toBe('session-1');
      expect(store.sessions[0].createdAt).toBeInstanceOf(Date);
    });

    it('获取失败应设置错误', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });

      await store.fetchSessions();

      expect(store.error).toBe('获取失败');
    });
  });

  describe('loadSession', () => {
    it('加载会话详情应更新当前消息', async () => {
      const store = useAIStore();

      const mockMessages: AIMessage[] = [
        {
          id: 'msg-1',
          sessionId: 'session-123',
          role: 'user',
          content: 'Hello',
          timestamp: new Date('2023-01-01'),
        },
      ];

      const mockResponse: AISessionDetailsResponse = {
        success: true,
        session: {
          sessionId: 'session-123',
          userId: 1,
          messages: mockMessages as any,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockResponse });

      await store.loadSession('session-123');

      expect(store.currentSessionId).toBe('session-123');
      expect(store.messages).toHaveLength(1);
      expect(store.messages[0].timestamp).toBeInstanceOf(Date);
    });
  });

  describe('deleteSession', () => {
    it('删除会话应从列表中移除并清空当前会话', async () => {
      const store = useAIStore();

      store.sessions = [
        {
          sessionId: 'session-1',
          userId: 1,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          sessionId: 'session-2',
          userId: 1,
          messages: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      store.currentSessionId = 'session-1';
      store.messages = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      const result = await store.deleteSession('session-1');

      expect(result).toBe(true);
      expect(store.sessions).toHaveLength(1);
      expect(store.sessions[0].sessionId).toBe('session-2');
      expect(store.currentSessionId).toBeNull();
      expect(store.messages).toEqual([]);
    });

    it('删除失败应返回 false 并设置错误', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.delete).mockRejectedValueOnce({
        response: { data: { message: '删除失败' } },
      });

      const result = await store.deleteSession('session-1');

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
    });
  });

  describe('startNewSession', () => {
    it('应清空当前会话状态', () => {
      const store = useAIStore();

      store.currentSessionId = 'session-1';
      store.messages = [
        {
          id: 'msg-1',
          sessionId: 'session-1',
          role: 'user',
          content: 'Test',
          timestamp: new Date(),
        },
      ];
      store.insights = [
        {
          type: 'recommendation',
          severity: 'info',
          title: 'Test',
          description: 'Test',
          actionable: false,
          timestamp: new Date(),
        },
      ];
      store.error = '错误';

      store.startNewSession();

      expect(store.currentSessionId).toBeNull();
      expect(store.messages).toEqual([]);
      expect(store.insights).toEqual([]);
      expect(store.suggestions).toEqual([]);
      expect(store.error).toBeNull();
    });
  });

  describe('fetchHealthSummary', () => {
    it('应获取系统健康摘要并更新洞察', async () => {
      const store = useAIStore();

      const mockResponse: AIHealthSummaryResponse = {
        success: true,
        summary: {
          overallStatus: 'healthy',
          activeConnections: 5,
          failedLoginAttempts24h: 2,
          sshFailures24h: 1,
          commandsExecuted24h: 100,
          topConnections: [],
          recentAlerts: [
            {
              type: 'security_alert',
              severity: 'high',
              title: '安全警报',
              description: '检测到异常登录',
              actionable: true,
              timestamp: new Date(),
            },
          ],
        },
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockResponse });

      await store.fetchHealthSummary();

      expect(store.healthSummary).toEqual(mockResponse.summary);
      expect(store.insights).toHaveLength(1);
      expect(store.insights[0].title).toBe('安全警报');
    });
  });

  describe('fetchCommandPatterns', () => {
    it('应获取命令模式分析', async () => {
      const store = useAIStore();

      const mockResponse: AICommandPatternsResponse = {
        success: true,
        analysis: {
          totalCommands: 1000,
          topCommands: [{ command: 'ls', count: 200, percentage: 20 }],
          unusualCommands: ['rm -rf /'],
          timeDistribution: { '08:00': 50, '09:00': 100 },
        },
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockResponse });

      await store.fetchCommandPatterns();

      expect(store.commandPatterns).toEqual(mockResponse.analysis);
    });
  });

  describe('cleanupSessions', () => {
    it('清理会话成功应返回删除数量并刷新列表', async () => {
      const store = useAIStore();

      const mockCleanupResponse: AICleanupResponse = {
        success: true,
        message: '清理成功',
        deletedCount: 10,
        keepCount: 50,
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: mockCleanupResponse });
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { success: true, sessions: [], limit: 50, offset: 0 },
      });

      const result = await store.cleanupSessions(50);

      expect(result).toBe(10);
      expect(apiClient.post).toHaveBeenCalledWith('/ai/cleanup', { keepCount: 50 });
    });

    it('清理失败应返回 0', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('清理失败'));

      const result = await store.cleanupSessions();

      expect(result).toBe(0);
      expect(store.error).toBe('清理失败');
    });
  });

  describe('clearError', () => {
    it('应清除错误状态', () => {
      const store = useAIStore();
      store.error = '错误信息';

      store.clearError();

      expect(store.error).toBeNull();
    });
  });

  describe('调试模式', () => {
    it('toggleDebugMode 应切换调试模式状态', () => {
      const store = useAIStore();
      expect(store.debugMode).toBe(false);

      store.toggleDebugMode();
      expect(store.debugMode).toBe(true);

      store.toggleDebugMode();
      expect(store.debugMode).toBe(false);
    });

    it('clearDebugLogs 应清空调试日志', () => {
      const store = useAIStore();
      store.debugLogs = [
        {
          id: 'dbg-1',
          timestamp: new Date(),
          type: 'request',
          source: 'query',
          data: {},
        },
      ];

      store.clearDebugLogs();
      expect(store.debugLogs).toEqual([]);
    });

    it('addDebugLog 调试模式开启时应添加日志', () => {
      const store = useAIStore();
      store.toggleDebugMode(); // 开启

      store.addDebugLog({ type: 'request', source: 'nl2cmd', data: { cmd: 'ls' } });

      expect(store.debugLogs).toHaveLength(1);
      expect(store.debugLogs[0].type).toBe('request');
      expect(store.debugLogs[0].source).toBe('nl2cmd');
    });

    it('addDebugLog 调试模式关闭时应忽略', () => {
      const store = useAIStore();
      // debugMode 默认 false

      store.addDebugLog({ type: 'request', source: 'query', data: {} });

      expect(store.debugLogs).toHaveLength(0);
    });

    it('sendQuery 调试模式开启时应记录请求和响应日志', async () => {
      const store = useAIStore();
      store.toggleDebugMode(); // 开启调试

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: {
          success: true,
          sessionId: 's1',
          message: {
            id: 'm1',
            sessionId: 's1',
            role: 'assistant',
            content: 'ok',
            timestamp: new Date(),
          },
          insights: [],
          suggestions: [],
        },
      });

      await store.sendQuery('测试');

      // 应有 request + response 两条日志
      const reqLogs = store.debugLogs.filter((l) => l.type === 'request');
      const resLogs = store.debugLogs.filter((l) => l.type === 'response');
      expect(reqLogs).toHaveLength(1);
      expect(resLogs).toHaveLength(1);
    });

    it('sendQuery 调试模式下失败应记录错误日志', async () => {
      const store = useAIStore();
      store.toggleDebugMode();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '失败' } },
      });

      await store.sendQuery('测试');

      const errLogs = store.debugLogs.filter((l) => l.type === 'error');
      expect(errLogs).toHaveLength(1);
    });
  });

  describe('sendQuery 补充', () => {
    it('响应 success=false 时应回滚乐观更新', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.post).mockResolvedValueOnce({
        data: { success: false, sessionId: 's1', message: null, insights: [], suggestions: [] },
      });

      await store.sendQuery('测试');

      expect(store.messages).toEqual([]);
      expect(store.error).toBeTruthy();
    });
  });

  describe('loadSession', () => {
    it('加载失败应设置错误', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '加载失败' } },
      });

      await store.loadSession('session-x');

      expect(store.error).toBe('加载失败');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('fetchHealthSummary', () => {
    it('获取失败应设置错误', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '健康检查失败' } },
      });

      await store.fetchHealthSummary();

      expect(store.error).toBe('健康检查失败');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('fetchCommandPatterns', () => {
    it('获取失败应设置错误', async () => {
      const store = useAIStore();

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '模式分析失败' } },
      });

      await store.fetchCommandPatterns();

      expect(store.error).toBe('模式分析失败');
      expect(store.isLoading).toBe(false);
    });
  });

  describe('deleteSession 补充', () => {
    it('删除非当前会话应保留当前会话状态', async () => {
      const store = useAIStore();
      store.sessions = [
        { sessionId: 's1', userId: 1, messages: [], createdAt: new Date(), updatedAt: new Date() },
        { sessionId: 's2', userId: 1, messages: [], createdAt: new Date(), updatedAt: new Date() },
      ];
      store.currentSessionId = 's1';

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      const result = await store.deleteSession('s2');

      expect(result).toBe(true);
      expect(store.currentSessionId).toBe('s1');
      expect(store.sessions).toHaveLength(1);
    });
  });
});
