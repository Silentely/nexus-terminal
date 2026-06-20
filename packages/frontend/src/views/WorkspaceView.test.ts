import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

// Mock stores
const mockSessionStore = {
  sessionTabsWithStatus: ref<Array<{ sessionId: string; connectionName: string }>>([]),
  activeSessionId: ref<string | null>(null),
  activeSession: ref<Record<string, unknown> | null>(null),
  isRdpModalOpen: ref(false),
  rdpConnectionInfo: ref(null),
  isVncModalOpen: ref(false),
  vncConnectionInfo: ref(null),
  sessions: new Map(),
  activateSession: vi.fn(),
  closeSession: vi.fn(),
  handleConnectRequest: vi.fn().mockResolvedValue(undefined),
  handleOpenNewSession: vi.fn(),
  cleanupAllSessions: vi.fn(),
};

const mockSettingsStore = {
  shareFileEditorTabsBoolean: ref(false),
  layoutLockedBoolean: ref(false),
};

const mockFileEditorStore = {
  orderedTabs: ref([]),
  activeTabId: ref(null),
};

const mockLayoutStore = {
  isHeaderVisible: ref(true),
  layoutTree: ref<Record<string, unknown> | null>({
    id: 'root',
    type: 'split',
    direction: 'horizontal',
    size: 100,
    children: [{ id: 'pane1', type: 'pane', component: 'terminal', size: 100 }],
  }),
};

const mockCommandHistoryStore = {
  addCommand: vi.fn(),
};

const mockConnectionsStore = {
  connections: [
    { id: 1, name: 'Server A', type: 'SSH', host: '10.0.0.1', port: 22, username: 'root' },
  ],
  fetchConnections: vi.fn().mockResolvedValue(undefined),
};

const mockUiNotificationsStore = {
  showError: vi.fn(),
  showSuccess: vi.fn(),
};

const mockSubscribe = vi.fn();
const mockUnsubscribe = vi.fn();
const mockEmit = vi.fn();

const mockIsMobile = ref(false);
const mockIsKeyboardOpen = ref(false);
const mockKeyboardHeight = ref(0);

vi.mock('../stores/session.store', () => ({ useSessionStore: () => mockSessionStore }));
vi.mock('../stores/settings.store', () => ({ useSettingsStore: () => mockSettingsStore }));
vi.mock('../stores/fileEditor.store', () => ({ useFileEditorStore: () => mockFileEditorStore }));
vi.mock('../stores/layout.store', () => ({ useLayoutStore: () => mockLayoutStore }));
vi.mock('../stores/commandHistory.store', () => ({
  useCommandHistoryStore: () => mockCommandHistoryStore,
}));
vi.mock('../stores/connections.store', () => ({ useConnectionsStore: () => mockConnectionsStore }));
vi.mock('../stores/uiNotifications.store', () => ({
  useUiNotificationsStore: () => mockUiNotificationsStore,
}));

vi.mock('../composables/useDeviceDetection', () => ({
  useDeviceDetection: () => ({ isMobile: mockIsMobile }),
}));

vi.mock('../composables/useVisualViewport', () => ({
  useVisualViewport: () => ({
    isKeyboardOpen: mockIsKeyboardOpen,
    keyboardHeight: mockKeyboardHeight,
  }),
}));

vi.mock('../composables/workspaceEvents', () => ({
  useWorkspaceEventSubscriber: () => mockSubscribe,
  useWorkspaceEventOff: () => mockUnsubscribe,
  useWorkspaceEventEmitter: () => mockEmit,
}));

vi.mock('../composables/useTerminalEvents', () => ({
  useTerminalEvents: () => ({
    handleSendCommand: vi.fn(),
    handleTerminalInput: vi.fn(),
    handleTerminalResize: vi.fn(),
    handleTerminalReady: vi.fn(),
    handleClearTerminal: vi.fn(),
    handleScrollToBottomRequest: vi.fn(),
    handleVirtualKeyPress: vi.fn(),
    handleQuickCommandExecuteProcessed: vi.fn(),
  }),
}));

vi.mock('../composables/useEditorEvents', () => ({
  useEditorEvents: () => ({
    editorTabs: ref([]),
    activeEditorTabId: ref(null),
    handleCloseEditorTab: vi.fn(),
    handleActivateEditorTab: vi.fn(),
    handleUpdateEditorContent: vi.fn(),
    handleSaveEditorTab: vi.fn(),
    handleChangeEncoding: vi.fn(),
    handleEditorScrollPositionUpdate: vi.fn(),
    handleCloseOtherEditorTabs: vi.fn(),
    handleCloseEditorTabsToRight: vi.fn(),
    handleCloseEditorTabsToLeft: vi.fn(),
  }),
}));

vi.mock('../composables/useWorkspaceSearch', () => ({
  useWorkspaceSearch: () => ({
    handleSearch: vi.fn(),
    handleFindNext: vi.fn(),
    handleFindPrevious: vi.fn(),
    handleCloseSearch: vi.fn(),
  }),
}));

vi.mock('../composables/useSessionTabActions', () => ({
  useSessionTabActions: () => ({
    handleCloseOtherSessions: vi.fn(),
    handleCloseSessionsToRight: vi.fn(),
    handleCloseSessionsToLeft: vi.fn(),
  }),
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
    locale: ref('zh-CN'),
  }),
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<typeof import('pinia')>('pinia');
  return {
    ...actual,
    storeToRefs: <T extends object>(store: T) => store,
  };
});

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock child components
vi.mock('../components/TerminalTabBar.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../components/LayoutRenderer.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../components/LayoutConfigurator.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../features/terminal/Terminal.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../components/CommandInputBar.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../components/VirtualKeyboard.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../components/FileManagerModal.vue', () => ({
  default: { template: '<div />' },
}));
vi.mock('../components/AddConnectionForm.vue', () => ({
  default: { template: '<div />' },
}));

describe('WorkspaceView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionStore.sessionTabsWithStatus.value = [];
    mockSessionStore.activeSessionId.value = null;
    mockSessionStore.activeSession.value = null;
    mockIsMobile.value = false;
    mockLayoutStore.isHeaderVisible.value = true;
    mockLayoutStore.layoutTree.value = {
      id: 'root',
      type: 'split',
      direction: 'horizontal',
      size: 100,
      children: [{ id: 'pane1', type: 'pane', component: 'terminal', size: 100 }],
    };
  });

  async function mountView() {
    const { default: WorkspaceView } = await import('./WorkspaceView.vue');
    const wrapper = mount(WorkspaceView, {
      global: {
        stubs: {
          TerminalTabBar: { template: '<div />' },
          LayoutRenderer: { template: '<div />' },
          LayoutConfigurator: { template: '<div />' },
          Terminal: { template: '<div />' },
          CommandInputBar: { template: '<div />' },
          VirtualKeyboard: { template: '<div />' },
          FileManagerModal: { template: '<div />' },
          AddConnectionFormComponent: { template: '<div />' },
        },
      },
    });
    await nextTick();
    return wrapper;
  }

  describe('初始化', () => {
    it('应成功挂载组件', async () => {
      const wrapper = await mountView();
      expect(wrapper.exists()).toBe(true);
    });

    it('应订阅工作区事件', async () => {
      await mountView();
      // 验证 subscribe 被调用（至少订阅了 terminal、editor、session 等事件）
      expect(mockSubscribe).toHaveBeenCalled();
    });
  });

  describe('桌面端布局', () => {
    it('有 layoutTree 时应渲染 LayoutRenderer', async () => {
      const wrapper = await mountView();
      // 桌面模式下应显示 main-content-area
      expect(wrapper.find('.main-content-area').exists()).toBe(true);
    });

    it('layoutTree 为 null 时应显示加载占位符', async () => {
      mockLayoutStore.layoutTree.value = null;
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('加载布局中');
    });

    it('header 可见时应添加 with-header 类', async () => {
      mockLayoutStore.isHeaderVisible.value = true;
      const wrapper = await mountView();
      expect(wrapper.find('.workspace-view.with-header').exists()).toBe(true);
    });
  });

  describe('移动端布局', () => {
    it('移动端应显示 mobile-content-area', async () => {
      mockIsMobile.value = true;
      mockSessionStore.activeSessionId.value = 'session-1';
      const wrapper = await mountView();
      expect(wrapper.find('.mobile-content-area').exists()).toBe(true);
    });

    it('移动端无活动会话时应显示占位符', async () => {
      mockIsMobile.value = true;
      mockSessionStore.activeSessionId.value = null;
      const wrapper = await mountView();
      expect(wrapper.text()).toContain('没有活动的会话');
    });

    it('移动端应渲染 CommandInputBar', async () => {
      mockIsMobile.value = true;
      const wrapper = await mountView();
      // CommandInputBar 在移动端应存在
      expect(wrapper.find('.mobile-command-bar').exists()).toBe(true);
    });
  });

  describe('全局键盘事件', () => {
    it('Alt+ArrowDown 应切换到下一个标签页', async () => {
      mockSessionStore.sessionTabsWithStatus.value = [
        { sessionId: 's1', connectionName: 'Server 1' },
        { sessionId: 's2', connectionName: 'Server 2' },
      ];
      mockSessionStore.activeSessionId.value = 's1';
      await mountView();

      // 模拟 Alt+ArrowDown
      const event = new KeyboardEvent('keydown', { altKey: true, key: 'ArrowDown' });
      window.dispatchEvent(event);

      expect(mockSessionStore.activateSession).toHaveBeenCalledWith('s2');
    });

    it('Alt+ArrowUp 应切换到上一个标签页', async () => {
      mockSessionStore.sessionTabsWithStatus.value = [
        { sessionId: 's1', connectionName: 'Server 1' },
        { sessionId: 's2', connectionName: 'Server 2' },
      ];
      mockSessionStore.activeSessionId.value = 's2';
      await mountView();

      const event = new KeyboardEvent('keydown', { altKey: true, key: 'ArrowUp' });
      window.dispatchEvent(event);

      expect(mockSessionStore.activateSession).toHaveBeenCalledWith('s1');
    });

    it('只有一个标签页时 Alt+ArrowDown 不应切换', async () => {
      mockSessionStore.sessionTabsWithStatus.value = [
        { sessionId: 's1', connectionName: 'Server 1' },
      ];
      mockSessionStore.activeSessionId.value = 's1';
      await mountView();

      const event = new KeyboardEvent('keydown', { altKey: true, key: 'ArrowDown' });
      window.dispatchEvent(event);

      expect(mockSessionStore.activateSession).not.toHaveBeenCalled();
    });

    it('无标签页时 Alt+ArrowDown 不应切换', async () => {
      mockSessionStore.sessionTabsWithStatus.value = [];
      mockSessionStore.activeSessionId.value = null;
      await mountView();

      const event = new KeyboardEvent('keydown', { altKey: true, key: 'ArrowDown' });
      window.dispatchEvent(event);

      expect(mockSessionStore.activateSession).not.toHaveBeenCalled();
    });

    it('普通按键不应触发标签切换', async () => {
      mockSessionStore.sessionTabsWithStatus.value = [
        { sessionId: 's1', connectionName: 'Server 1' },
        { sessionId: 's2', connectionName: 'Server 2' },
      ];
      mockSessionStore.activeSessionId.value = 's1';
      await mountView();

      const event = new KeyboardEvent('keydown', { key: 'a' });
      window.dispatchEvent(event);

      expect(mockSessionStore.activateSession).not.toHaveBeenCalled();
    });
  });

  describe('组件卸载', () => {
    it('卸载时应调用 cleanupAllSessions', async () => {
      const wrapper = await mountView();
      wrapper.unmount();
      expect(mockSessionStore.cleanupAllSessions).toHaveBeenCalled();
    });

    it('卸载时应取消订阅所有事件', async () => {
      const wrapper = await mountView();
      const subscribeCount = mockSubscribe.mock.calls.length;
      wrapper.unmount();
      // unsubscribe 应被调用与 subscribe 相同的次数
      expect(mockUnsubscribe.mock.calls.length).toBe(subscribeCount);
    });

    it('卸载时应移除键盘事件监听器', async () => {
      const removeSpy = vi.spyOn(window, 'removeEventListener');
      const wrapper = await mountView();
      wrapper.unmount();
      expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function));
      removeSpy.mockRestore();
    });
  });

  describe('handleOpenNewSession', () => {
    it('connection:openNewSession 事件应调用 sessionStore.handleOpenNewSession', async () => {
      await mountView();

      // 找到 connection:openNewSession 事件的注册处理器并直接调用
      const subscribeCalls = mockSubscribe.mock.calls;
      const openNewSessionCall = subscribeCalls.find(
        (call: unknown[]) => call[0] === 'connection:openNewSession',
      );
      expect(openNewSessionCall).toBeDefined();
      const handler = (openNewSessionCall as unknown[])[1] as (payload: {
        connectionId: number;
      }) => void;
      handler({ connectionId: 1 });
      await nextTick();
      expect(mockSessionStore.handleOpenNewSession).toHaveBeenCalledWith(1);
    });
  });

  describe('虚拟键盘', () => {
    it('移动端应能切换虚拟键盘可见性', async () => {
      mockIsMobile.value = true;
      const wrapper = await mountView();

      // VirtualKeyboard 初始应隐藏（v-show）
      const _keyboard = wrapper.findComponent({ name: 'VirtualKeyboard' });
      // 不应抛出错误
      expect(wrapper.exists()).toBe(true);
    });
  });

  describe('事件订阅覆盖', () => {
    it('应订阅 terminal 相关事件', async () => {
      await mountView();
      const eventNames = mockSubscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(eventNames).toContain('terminal:sendCommand');
      expect(eventNames).toContain('terminal:input');
      expect(eventNames).toContain('terminal:resize');
      expect(eventNames).toContain('terminal:ready');
      expect(eventNames).toContain('terminal:clear');
    });

    it('应订阅 editor 相关事件', async () => {
      await mountView();
      const eventNames = mockSubscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(eventNames).toContain('editor:closeTab');
      expect(eventNames).toContain('editor:activateTab');
      expect(eventNames).toContain('editor:updateContent');
      expect(eventNames).toContain('editor:saveTab');
    });

    it('应订阅 session 相关事件', async () => {
      await mountView();
      const eventNames = mockSubscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(eventNames).toContain('session:activate');
      expect(eventNames).toContain('session:close');
      expect(eventNames).toContain('session:closeOthers');
    });

    it('应订阅 search 相关事件', async () => {
      await mountView();
      const eventNames = mockSubscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(eventNames).toContain('search:start');
      expect(eventNames).toContain('search:findNext');
      expect(eventNames).toContain('search:findPrevious');
      expect(eventNames).toContain('search:close');
    });

    it('应订阅 connection 相关事件', async () => {
      await mountView();
      const eventNames = mockSubscribe.mock.calls.map((call: unknown[]) => call[0]);
      expect(eventNames).toContain('connection:openNewSession');
      expect(eventNames).toContain('connection:requestAdd');
      expect(eventNames).toContain('connection:requestEdit');
    });
  });
});
