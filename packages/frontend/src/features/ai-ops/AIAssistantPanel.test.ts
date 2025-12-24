/**
 * AIAssistantPanel.vue 单元测试
 * 测试 AI 助手面板组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import AIAssistantPanel from './AIAssistantPanel.vue';
import type { AIMessage, AISession, AIInsight } from '../../types/ai.types';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Use vi.hoisted to ensure mock state exists before mocks are processed
const {
  mockState,
  mockSendQuery,
  mockFetchSessions,
  mockLoadSession,
  mockDeleteSession,
  mockStartNewSession,
  mockClearError,
} = vi.hoisted(() => ({
  mockState: {
    currentSessionId: null as string | null,
    messages: [] as AIMessage[],
    sessions: [] as AISession[],
    isLoading: false,
    isTyping: false,
    error: null as string | null,
    insights: [] as AIInsight[],
    suggestions: [] as string[],
  },
  mockSendQuery: vi.fn(),
  mockFetchSessions: vi.fn(),
  mockLoadSession: vi.fn(),
  mockDeleteSession: vi.fn(),
  mockStartNewSession: vi.fn(),
  mockClearError: vi.fn(),
}));

// Mock AI store - return getters that read from mockState
vi.mock('../../stores/ai.store', () => ({
  useAIStore: () => ({
    get currentSessionId() {
      return mockState.currentSessionId;
    },
    get messages() {
      return mockState.messages;
    },
    get sessions() {
      return mockState.sessions;
    },
    get isLoading() {
      return mockState.isLoading;
    },
    get isTyping() {
      return mockState.isTyping;
    },
    get error() {
      return mockState.error;
    },
    get insights() {
      return mockState.insights;
    },
    get suggestions() {
      return mockState.suggestions;
    },
    sendQuery: mockSendQuery,
    fetchSessions: mockFetchSessions,
    loadSession: mockLoadSession,
    deleteSession: mockDeleteSession,
    startNewSession: mockStartNewSession,
    clearError: mockClearError,
  }),
}));

// Factory function to create mock messages
function createMockMessage(options: Partial<AIMessage> = {}): AIMessage {
  return {
    id: options.id || `msg-${Date.now()}`,
    sessionId: options.sessionId || 'session-1',
    role: options.role || 'user',
    content: options.content || 'Test message',
    timestamp: options.timestamp || new Date(),
    ...options,
  };
}

// Factory function to create mock sessions
function createMockSession(options: Partial<AISession> = {}): AISession {
  return {
    sessionId: options.sessionId || `session-${Date.now()}`,
    userId: options.userId || 1,
    title: options.title || 'Test Session',
    messages: options.messages || [],
    createdAt: options.createdAt || new Date(),
    updatedAt: options.updatedAt || new Date(),
    ...options,
  };
}

// Factory function to create mock insights
function createMockInsight(options: Partial<AIInsight> = {}): AIInsight {
  return {
    type: options.type || 'recommendation',
    severity: options.severity || 'info',
    title: options.title || 'Test Insight',
    description: options.description || 'Test description',
    actionable: options.actionable ?? true,
    suggestedAction: options.suggestedAction || 'Take action',
    timestamp: options.timestamp || new Date(),
    ...options,
  };
}

describe('AIAssistantPanel.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset mock state
    mockState.currentSessionId = null;
    mockState.messages = [];
    mockState.sessions = [];
    mockState.isLoading = false;
    mockState.isTyping = false;
    mockState.error = null;
    mockState.insights = [];
    mockState.suggestions = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('应正确渲染面板标题和按钮', () => {
      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.fa-robot').exists()).toBe(true);
      expect(wrapper.text()).toContain('AI Assistant');
      expect(wrapper.find('.fa-plus').exists()).toBe(true); // New session
      expect(wrapper.find('.fa-history').exists()).toBe(true); // History
      expect(wrapper.find('.fa-times').exists()).toBe(true); // Close
    });

    it('应显示会话 ID 截断版本', () => {
      mockState.currentSessionId = 'abcd1234-5678-90ab-cdef-1234567890ab';

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.text()).toContain('abcd1234...');
    });

    it('无消息时应显示空状态和快速建议', () => {
      mockState.messages = [];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.fa-magic').exists()).toBe(true);
      expect(wrapper.text()).toContain('Ask me anything about your servers or logs...');
      // 快速建议按钮
      expect(wrapper.text()).toContain('Check System Health');
      expect(wrapper.text()).toContain('Analyze Command Patterns');
      expect(wrapper.text()).toContain('View Security Events');
      expect(wrapper.text()).toContain('Connection Status');
    });

    it('应渲染输入区域', () => {
      const wrapper = mount(AIAssistantPanel);

      const input = wrapper.find('input[type="text"]');
      expect(input.exists()).toBe(true);
      expect(input.attributes('placeholder')).toContain('Type a message...');
      expect(wrapper.find('.fa-paper-plane').exists()).toBe(true);
    });
  });

  describe('消息列表渲染', () => {
    it('应渲染用户消息', () => {
      mockState.messages = [createMockMessage({ role: 'user', content: 'Hello AI' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.text()).toContain('Hello AI');
      // 用户消息应有 self-end 样式
      expect(wrapper.find('.self-end').exists()).toBe(true);
    });

    it('应渲染 AI 消息', () => {
      mockState.messages = [createMockMessage({ role: 'assistant', content: 'Hello User' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.text()).toContain('Hello User');
      // AI 消息应有 self-start 样式
      expect(wrapper.find('.self-start').exists()).toBe(true);
    });

    it('应正确格式化消息中的 Markdown', () => {
      mockState.messages = [
        createMockMessage({ role: 'assistant', content: '**bold** and `code`' }),
      ];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.html()).toContain('<strong>bold</strong>');
      expect(wrapper.html()).toContain('<code');
      expect(wrapper.html()).toContain('code</code>');
    });

    it('应对消息进行 XSS 防护', () => {
      mockState.messages = [
        createMockMessage({ role: 'user', content: '<script>alert("xss")</script>' }),
      ];

      const wrapper = mount(AIAssistantPanel);

      // 应被转义，不应直接包含 script 标签
      expect(wrapper.html()).not.toContain('<script>');
      expect(wrapper.html()).toContain('&lt;script&gt;');
    });

    it('应显示消息时间戳', () => {
      const testDate = new Date('2025-12-24T10:30:00');
      mockState.messages = [createMockMessage({ timestamp: testDate })];

      const wrapper = mount(AIAssistantPanel);

      // 检查时间格式化 (HH:MM)
      expect(wrapper.text()).toMatch(/10:30|10:30 AM/);
    });
  });

  describe('加载状态', () => {
    it('AI 输入中应显示加载指示器', () => {
      mockState.isTyping = true;

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.fa-spinner.fa-spin').exists()).toBe(true);
      expect(wrapper.text()).toContain('AI is analyzing...');
    });

    it('AI 输入中应禁用输入框', () => {
      mockState.isTyping = true;

      const wrapper = mount(AIAssistantPanel);

      const input = wrapper.find('input[type="text"]');
      expect(input.attributes('disabled')).toBeDefined();
    });

    it('无消息且 AI 输入中应禁用发送按钮', () => {
      mockState.isTyping = true;

      const wrapper = mount(AIAssistantPanel);

      const sendButton = wrapper.find('.fa-paper-plane').element.closest('button');
      expect(sendButton?.hasAttribute('disabled')).toBe(true);
    });
  });

  describe('错误处理', () => {
    it('有错误时应显示错误消息', () => {
      mockState.error = 'Connection failed';

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.fa-exclamation-circle').exists()).toBe(true);
      expect(wrapper.text()).toContain('Connection failed');
    });

    it('点击 Dismiss 应清除错误', async () => {
      mockState.error = 'Some error';

      const wrapper = mount(AIAssistantPanel);

      const dismissButton = wrapper.find('.underline');
      await dismissButton.trigger('click');

      expect(mockClearError).toHaveBeenCalled();
    });
  });

  describe('消息发送', () => {
    it('按 Enter 键应发送消息', async () => {
      const wrapper = mount(AIAssistantPanel);

      const input = wrapper.find('input[type="text"]');
      await input.setValue('Test query');
      await input.trigger('keydown', { key: 'Enter' });

      expect(mockSendQuery).toHaveBeenCalledWith('Test query');
    });

    it('点击发送按钮应发送消息', async () => {
      const wrapper = mount(AIAssistantPanel);

      const input = wrapper.find('input[type="text"]');
      await input.setValue('Another query');

      const sendButton = wrapper.find('.fa-paper-plane').element.closest('button');
      await (sendButton as HTMLButtonElement)?.click();

      expect(mockSendQuery).toHaveBeenCalledWith('Another query');
    });

    it('空消息不应发送', async () => {
      const wrapper = mount(AIAssistantPanel);

      const input = wrapper.find('input[type="text"]');
      await input.setValue('   ');
      await input.trigger('keydown', { key: 'Enter' });

      expect(mockSendQuery).not.toHaveBeenCalled();
    });

    it('发送后应清空输入框', async () => {
      const wrapper = mount(AIAssistantPanel);

      const input = wrapper.find('input[type="text"]');
      await input.setValue('Clear me');
      await input.trigger('keydown', { key: 'Enter' });

      expect((input.element as HTMLInputElement).value).toBe('');
    });

    it('点击快速建议应发送对应查询', async () => {
      mockState.messages = [];

      const wrapper = mount(AIAssistantPanel);

      // 找到第一个快速建议按钮（Check System Health）
      const suggestionButtons = wrapper
        .findAll('button')
        .filter((b) => b.text().includes('Check System Health'));

      if (suggestionButtons.length > 0) {
        await suggestionButtons[0].trigger('click');
        expect(mockSendQuery).toHaveBeenCalledWith('系统健康状态如何？');
      }
    });
  });

  describe('建议列表', () => {
    it('有建议时应显示建议按钮', () => {
      mockState.suggestions = ['Suggestion 1', 'Suggestion 2', 'Suggestion 3'];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.text()).toContain('Suggestion 1');
      expect(wrapper.text()).toContain('Suggestion 2');
      expect(wrapper.text()).toContain('Suggestion 3');
    });

    it('最多显示 3 个建议', () => {
      mockState.suggestions = ['S1', 'S2', 'S3', 'S4', 'S5'];

      const wrapper = mount(AIAssistantPanel);

      const text = wrapper.text();
      expect(text).toContain('S1');
      expect(text).toContain('S2');
      expect(text).toContain('S3');
      expect(text).not.toContain('S4');
    });

    it('点击建议应发送对应查询', async () => {
      mockState.suggestions = ['Run diagnostics'];

      const wrapper = mount(AIAssistantPanel);

      // 找到建议按钮（在输入区域下方）
      const suggestionButton = wrapper
        .findAll('button')
        .find((b) => b.text() === 'Run diagnostics');

      if (suggestionButton) {
        await suggestionButton.trigger('click');
        expect(mockSendQuery).toHaveBeenCalledWith('Run diagnostics');
      }
    });
  });

  describe('洞察面板', () => {
    it('无洞察时不应显示洞察面板', () => {
      mockState.insights = [];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.fa-lightbulb').exists()).toBe(false);
    });

    it('有洞察时应显示洞察面板', () => {
      mockState.insights = [createMockInsight()];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.fa-lightbulb').exists()).toBe(true);
      expect(wrapper.text()).toContain('Insights');
      expect(wrapper.text()).toContain('(1)');
    });

    it('点击洞察按钮应切换展开状态', async () => {
      mockState.insights = [createMockInsight({ title: 'Test Insight', description: 'Test Desc' })];

      const wrapper = mount(AIAssistantPanel);

      // 初始折叠状态
      expect(wrapper.find('.fa-chevron-up').exists()).toBe(true);

      // 点击展开
      const toggleButton = wrapper.find('.fa-lightbulb').element.closest('button');
      await (toggleButton as HTMLButtonElement)?.click();

      // 应显示洞察内容
      expect(wrapper.text()).toContain('Test Insight');
      expect(wrapper.text()).toContain('Test Desc');
    });

    it('应显示不同严重级别的样式', async () => {
      mockState.insights = [createMockInsight({ severity: 'critical', title: 'Critical Issue' })];

      const wrapper = mount(AIAssistantPanel);

      // 展开洞察面板
      const toggleButton = wrapper.find('.fa-lightbulb').element.closest('button');
      await (toggleButton as HTMLButtonElement)?.click();

      // 应有红色样式
      expect(wrapper.html()).toContain('border-red-500');
    });

    it('应显示建议操作', async () => {
      mockState.insights = [createMockInsight({ suggestedAction: 'Please restart the service' })];

      const wrapper = mount(AIAssistantPanel);

      // 展开洞察面板
      const toggleButton = wrapper.find('.fa-lightbulb').element.closest('button');
      await (toggleButton as HTMLButtonElement)?.click();

      expect(wrapper.text()).toContain('Please restart the service');
      expect(wrapper.find('.fa-hand-point-right').exists()).toBe(true);
    });
  });

  describe('历史面板', () => {
    it('点击历史按钮应显示历史面板并获取会话', async () => {
      const wrapper = mount(AIAssistantPanel);

      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();

      expect(mockFetchSessions).toHaveBeenCalled();
      expect(wrapper.text()).toContain('Session History');
    });

    it('历史面板加载中应显示加载状态', async () => {
      mockState.isLoading = true;

      const wrapper = mount(AIAssistantPanel);

      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      expect(wrapper.find('.fa-spinner.fa-spin').exists()).toBe(true);
      expect(wrapper.text()).toContain('Loading...');
    });

    it('无会话时应显示空状态', async () => {
      mockState.sessions = [];
      mockState.isLoading = false;

      const wrapper = mount(AIAssistantPanel);

      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      expect(wrapper.text()).toContain('No previous sessions');
    });

    it('应渲染会话列表', async () => {
      mockState.sessions = [
        createMockSession({ sessionId: 's1', title: 'Session One' }),
        createMockSession({ sessionId: 's2', title: 'Session Two' }),
      ];
      mockState.isLoading = false;

      const wrapper = mount(AIAssistantPanel);

      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      expect(wrapper.text()).toContain('Session One');
      expect(wrapper.text()).toContain('Session Two');
    });

    it('无标题的会话应显示 Untitled', async () => {
      mockState.sessions = [createMockSession({ sessionId: 's1', title: undefined })];
      mockState.isLoading = false;

      const wrapper = mount(AIAssistantPanel);

      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      expect(wrapper.text()).toContain('Untitled');
    });

    it('点击会话应加载会话详情', async () => {
      mockState.sessions = [createMockSession({ sessionId: 's1', title: 'Test Session' })];
      mockState.isLoading = false;

      const wrapper = mount(AIAssistantPanel);

      // 打开历史面板
      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      // 点击会话
      const sessionItem = wrapper.find('.cursor-pointer');
      await sessionItem.trigger('click');

      expect(mockLoadSession).toHaveBeenCalledWith('s1');
    });

    it('点击删除按钮应删除会话', async () => {
      mockState.sessions = [createMockSession({ sessionId: 's1', title: 'Test Session' })];
      mockState.isLoading = false;

      const wrapper = mount(AIAssistantPanel);

      // 打开历史面板
      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      // 点击删除按钮
      const deleteButton = wrapper.find('.fa-trash-alt').element.closest('button');
      await (deleteButton as HTMLButtonElement)?.click();

      expect(mockDeleteSession).toHaveBeenCalledWith('s1');
    });

    it('点击返回按钮应关闭历史面板', async () => {
      const wrapper = mount(AIAssistantPanel);

      // 打开历史面板
      const historyButton = wrapper.find('.fa-history').element.closest('button');
      await (historyButton as HTMLButtonElement)?.click();
      await nextTick();

      // 点击返回
      const backButton = wrapper.find('.fa-arrow-left').element.closest('button');
      await (backButton as HTMLButtonElement)?.click();
      await nextTick();

      // 历史面板应关闭
      expect(wrapper.text()).not.toContain('Session History');
    });
  });

  describe('新建会话', () => {
    it('点击新建会话按钮应调用 startNewSession', async () => {
      const wrapper = mount(AIAssistantPanel);

      const newButton = wrapper.find('.fa-plus').element.closest('button');
      await (newButton as HTMLButtonElement)?.click();

      expect(mockStartNewSession).toHaveBeenCalled();
    });
  });

  describe('关闭面板', () => {
    it('点击关闭按钮应触发 close 事件', async () => {
      const wrapper = mount(AIAssistantPanel);

      const closeButton = wrapper.find('.fa-times').element.closest('button');
      await (closeButton as HTMLButtonElement)?.click();

      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('严重级别样式', () => {
    it.each([
      ['info', 'border-blue-500'],
      ['low', 'border-green-500'],
      ['medium', 'border-yellow-500'],
      ['high', 'border-orange-500'],
      ['critical', 'border-red-500'],
    ] as const)('severity %s 应应用 %s 样式', async (severity, expectedClass) => {
      mockState.insights = [createMockInsight({ severity, title: `${severity} insight` })];

      const wrapper = mount(AIAssistantPanel);

      // 展开洞察面板
      const toggleButton = wrapper.find('.fa-lightbulb').element.closest('button');
      await (toggleButton as HTMLButtonElement)?.click();

      expect(wrapper.html()).toContain(expectedClass);
    });
  });

  describe('消息格式化', () => {
    it('应正确处理标题格式', () => {
      mockState.messages = [createMockMessage({ content: '## Big Title\n### Small Title' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.html()).toContain('font-bold text-lg');
      expect(wrapper.html()).toContain('font-bold text-base');
    });

    it('应正确处理列表格式', () => {
      mockState.messages = [createMockMessage({ content: '- Item 1\n- Item 2' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.html()).toContain('• Item 1');
      expect(wrapper.html()).toContain('• Item 2');
    });

    it('应将换行转换为 br 标签', () => {
      mockState.messages = [createMockMessage({ content: 'Line 1\nLine 2' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.html()).toContain('<br>');
    });
  });

  describe('样式', () => {
    it('面板容器应有正确的样式类', () => {
      const wrapper = mount(AIAssistantPanel);

      const container = wrapper.find('.bg-background');
      expect(container.exists()).toBe(true);
      expect(container.classes()).toContain('flex');
      expect(container.classes()).toContain('flex-col');
      expect(container.classes()).toContain('h-full');
    });

    it('用户消息应有主色背景', () => {
      mockState.messages = [createMockMessage({ role: 'user' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.bg-primary.text-white').exists()).toBe(true);
    });

    it('AI 消息应有头部背景', () => {
      mockState.messages = [createMockMessage({ role: 'assistant' })];

      const wrapper = mount(AIAssistantPanel);

      expect(wrapper.find('.bg-header').exists()).toBe(true);
    });
  });
});
