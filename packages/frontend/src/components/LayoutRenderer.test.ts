/**
 * LayoutRenderer.vue 单元测试
 * 测试布局渲染器组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, shallowMount, config } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick, defineComponent, h } from 'vue';
import LayoutRenderer from './LayoutRenderer.vue';
import type { LayoutNode, PaneName } from '../stores/layout.store';

// 创建 mock ref 的辅助函数
function mockRef<T>(value: T): { value: T; __v_isRef: true } {
  return { value, __v_isRef: true as const };
}

// Mock 状态（hoisted）
const {
  mockLayoutStore,
  mockSessionStore,
  mockFileEditorStore,
  mockSettingsStore,
  mockAppearanceStore,
} = vi.hoisted(() => ({
  mockLayoutStore: {
    updateNodeSizes: vi.fn(),
    sidebarPanes: { left: [] as PaneName[], right: [] as PaneName[] },
  },
  mockSessionStore: {
    sessions: new Map(),
    activeSession: null,
  },
  mockFileEditorStore: {
    orderedTabs: [] as any[],
    activeTabId: null as string | null,
  },
  mockSettingsStore: {
    workspaceSidebarPersistentBoolean: false,
    getSidebarPaneWidth: vi.fn(() => '300px'),
    updateSidebarPaneWidth: vi.fn(),
  },
  mockAppearanceStore: {
    terminalBackgroundImage: null as string | null,
    isTerminalBackgroundEnabled: false,
    currentTerminalBackgroundOverlayOpacity: 0,
    terminalCustomHTML: null as string | null,
  },
}));

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

// Mock workspace events
vi.mock('../composables/workspaceEvents', () => ({
  useWorkspaceEventSubscriber: () => vi.fn(),
  useWorkspaceEventOff: () => vi.fn(),
}));

// Mock stores
vi.mock('../stores/layout.store', () => ({
  useLayoutStore: () => mockLayoutStore,
}));

vi.mock('../stores/session.store', () => ({
  useSessionStore: () => mockSessionStore,
}));

vi.mock('../stores/fileEditor.store', () => ({
  useFileEditorStore: () => mockFileEditorStore,
}));

vi.mock('../stores/settings.store', () => ({
  useSettingsStore: () => mockSettingsStore,
}));

vi.mock('../stores/appearance.store', () => ({
  useAppearanceStore: () => mockAppearanceStore,
}));

// Mock pinia storeToRefs
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: any) => {
      // 根据 store 类型返回适当的 refs
      if (store.sessions !== undefined) {
        // session store
        return {
          activeSession: mockRef(mockSessionStore.activeSession),
        };
      }
      if (store.orderedTabs !== undefined) {
        // fileEditor store
        return {
          orderedTabs: mockRef(mockFileEditorStore.orderedTabs),
          activeTabId: mockRef(mockFileEditorStore.activeTabId),
        };
      }
      if (store.getSidebarPaneWidth !== undefined) {
        // settings store
        return {
          workspaceSidebarPersistentBoolean: mockRef(
            mockSettingsStore.workspaceSidebarPersistentBoolean
          ),
          getSidebarPaneWidth: mockRef(mockSettingsStore.getSidebarPaneWidth),
        };
      }
      if (store.terminalBackgroundImage !== undefined) {
        // appearance store
        return {
          terminalBackgroundImage: mockRef(mockAppearanceStore.terminalBackgroundImage),
          isTerminalBackgroundEnabled: mockRef(mockAppearanceStore.isTerminalBackgroundEnabled),
          currentTerminalBackgroundOverlayOpacity: mockRef(
            mockAppearanceStore.currentTerminalBackgroundOverlayOpacity
          ),
          terminalCustomHTML: mockRef(mockAppearanceStore.terminalCustomHTML),
        };
      }
      if (store.sidebarPanes !== undefined) {
        // layout store
        return {
          sidebarPanes: mockRef(mockLayoutStore.sidebarPanes),
        };
      }
      return {};
    },
  };
});

// Mock splitpanes
vi.mock('splitpanes', () => ({
  Splitpanes: defineComponent({
    name: 'Splitpanes',
    props: ['horizontal', 'pushOtherPanes', 'dblClickSplitter'],
    emits: ['resized'],
    setup(_, { slots }) {
      return () => h('div', { class: 'mock-splitpanes' }, slots.default?.());
    },
  }),
  Pane: defineComponent({
    name: 'Pane',
    props: ['size', 'minSize'],
    setup(_, { slots }) {
      return () => h('div', { class: 'mock-pane' }, slots.default?.());
    },
  }),
}));

// Mock DOMPurify
vi.mock('dompurify', () => ({
  default: {
    sanitize: vi.fn((html: string) => html),
  },
}));

// Mock sidebar resize composable
vi.mock('../composables/useSidebarResize', () => ({
  useSidebarResize: vi.fn(),
}));

// 创建 stub 组件的辅助函数
function createStubComponent(name: string, className: string) {
  return defineComponent({
    name,
    setup() {
      return () => h('div', { class: className });
    },
  });
}

// 定义全局 stubs
const globalStubs = {
  WorkspaceConnectionList: createStubComponent('WorkspaceConnectionList', 'mock-connections'),
  Terminal: createStubComponent('Terminal', 'mock-terminal'),
  CommandInputBar: createStubComponent('CommandInputBar', 'mock-command-bar'),
  FileManager: createStubComponent('FileManager', 'mock-file-manager'),
  FileEditorContainer: createStubComponent('FileEditorContainer', 'mock-editor'),
  StatusMonitor: createStubComponent('StatusMonitor', 'mock-status-monitor'),
  CommandHistoryView: createStubComponent('CommandHistoryView', 'mock-command-history'),
  QuickCommandsView: createStubComponent('QuickCommandsView', 'mock-quick-commands'),
  DockerManager: createStubComponent('DockerManager', 'mock-docker-manager'),
  SuspendedSshSessionsView: createStubComponent(
    'SuspendedSshSessionsView',
    'mock-suspended-sessions'
  ),
  AIAssistantPanel: createStubComponent('AIAssistantPanel', 'mock-ai-assistant'),
  MultiServerExec: createStubComponent('MultiServerExec', 'mock-batch-exec'),
  // Async component wrapper stub
  AsyncComponentWrapper: true,
  Suspense: true,
};

// 创建测试用的 layoutNode
function createPaneNode(component: PaneName, id = 'pane-1'): LayoutNode {
  return {
    id,
    type: 'pane',
    component,
  };
}

function createContainerNode(
  direction: 'horizontal' | 'vertical',
  children: LayoutNode[],
  id = 'container-1'
): LayoutNode {
  return {
    id,
    type: 'container',
    direction,
    children,
  };
}

describe('LayoutRenderer.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // 重置 mock 状态
    mockLayoutStore.sidebarPanes = { left: [], right: [] };
    mockSessionStore.sessions = new Map();
    mockSessionStore.activeSession = null;
    mockFileEditorStore.orderedTabs = [];
    mockFileEditorStore.activeTabId = null;
    mockSettingsStore.workspaceSidebarPersistentBoolean = false;
    mockAppearanceStore.isTerminalBackgroundEnabled = false;
    mockAppearanceStore.terminalBackgroundImage = null;
    mockAppearanceStore.terminalCustomHTML = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('应正确渲染根布局容器', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
          isRootRenderer: true,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.find('.relative.flex.h-full.w-full').exists()).toBe(true);
    });

    it('应接受 layoutNode prop', () => {
      const node = createPaneNode('connections');
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: node,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('layoutNode')).toEqual(node);
    });

    it('应渲染容器节点', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createContainerNode('horizontal', [
            createPaneNode('connections', 'child-1'),
            createPaneNode('commandBar', 'child-2'),
          ]),
        },
        global: { stubs: globalStubs },
      });

      // shallowMount 会 stub Splitpanes，检查容器是否存在
      expect(wrapper.findComponent({ name: 'Splitpanes' }).exists()).toBe(true);
    });

    it('应根据 direction 渲染 horizontal 容器', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createContainerNode('horizontal', [
            createPaneNode('connections', 'child-1'),
            createPaneNode('commandBar', 'child-2'),
          ]),
        },
        global: { stubs: globalStubs },
      });

      const splitpanes = wrapper.findComponent({ name: 'Splitpanes' });
      expect(splitpanes.exists()).toBe(true);
    });

    it('应根据 direction 渲染 vertical 容器', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createContainerNode('vertical', [
            createPaneNode('connections', 'child-1'),
            createPaneNode('commandBar', 'child-2'),
          ]),
        },
        global: { stubs: globalStubs },
      });

      const splitpanes = wrapper.findComponent({ name: 'Splitpanes' });
      expect(splitpanes.exists()).toBe(true);
    });

    it('无效面板组件应显示错误信息', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: {
            id: 'invalid-pane',
            type: 'pane',
            component: 'invalidComponent' as any,
          },
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.text()).toContain('无效面板组件');
    });
  });

  describe('Props 测试', () => {
    it('应接受 isRootRenderer prop', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
          isRootRenderer: true,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('isRootRenderer')).toBe(true);
    });

    it('isRootRenderer 默认值应为 false', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('isRootRenderer')).toBe(false);
    });

    it('应接受 activeSessionId prop', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
          activeSessionId: 'session-123',
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('activeSessionId')).toBe('session-123');
    });

    it('应接受 layoutLocked prop', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
          layoutLocked: true,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('layoutLocked')).toBe(true);
    });

    it('layoutLocked 默认值应为 false', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('layoutLocked')).toBe(false);
    });

    it('应接受 editorTabs prop', () => {
      const tabs = [{ id: 'tab-1', name: 'test.ts' }];
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('editor'),
          editorTabs: tabs,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('editorTabs')).toEqual(tabs);
    });

    it('应接受 activeEditorTabId prop', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('editor'),
          activeEditorTabId: 'tab-1',
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('activeEditorTabId')).toBe('tab-1');
    });
  });

  describe('侧边栏渲染', () => {
    it('有左侧边栏配置时应渲染左侧边栏容器', async () => {
      mockLayoutStore.sidebarPanes = { left: ['connections'], right: [] };

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          isRootRenderer: true,
        },
        global: { stubs: globalStubs },
      });

      await nextTick();

      // 检查是否有侧边栏按钮容器
      expect(wrapper.find('.bg-sidebar').exists()).toBe(true);
    });

    it('有右侧边栏配置时应渲染右侧边栏容器', async () => {
      mockLayoutStore.sidebarPanes = { left: [], right: ['fileManager'] };

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          isRootRenderer: true,
        },
        global: { stubs: globalStubs },
      });

      await nextTick();

      // 检查是否有侧边栏按钮容器
      expect(wrapper.find('.bg-sidebar').exists()).toBe(true);
    });

    it('非根渲染器不应渲染侧边栏按钮', () => {
      mockLayoutStore.sidebarPanes = { left: ['connections'], right: ['fileManager'] };

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          isRootRenderer: false,
        },
        global: { stubs: globalStubs },
      });

      // 非 root 渲染器不应该有侧边栏
      expect(wrapper.findAll('.bg-sidebar').length).toBe(0);
    });
  });

  describe('终端面板特殊处理', () => {
    it('终端面板无活动会话时应显示占位符', () => {
      mockSessionStore.sessions = new Map();

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          activeSessionId: null,
        },
        global: { stubs: globalStubs },
      });

      // 应该显示无活动会话的提示
      expect(wrapper.find('.fa-plug').exists()).toBe(true);
    });

    it('终端面板有会话但无 terminalManager 时应显示占位符', async () => {
      mockSessionStore.sessions = new Map([['session-1', { terminalManager: null }]]);

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          activeSessionId: 'session-1',
        },
        global: { stubs: globalStubs },
      });

      await nextTick();

      // 应该显示无 SSH 会话的提示
      expect(wrapper.find('.fa-plug').exists()).toBe(true);
    });
  });

  describe('文件管理器特殊处理', () => {
    it('文件管理器无活动会话时应显示占位符', () => {
      mockSessionStore.activeSession = null;

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('fileManager'),
          activeSessionId: null,
        },
        global: { stubs: globalStubs },
      });

      // 应该显示无活动会话的提示
      expect(wrapper.find('.fa-plug').exists()).toBe(true);
    });
  });

  describe('状态监视器特殊处理', () => {
    it('状态监视器无活动会话时应显示占位符', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('statusMonitor'),
          activeSessionId: null,
        },
        global: { stubs: globalStubs },
      });

      // 应该显示无活动会话的提示
      expect(wrapper.find('.fa-plug').exists()).toBe(true);
    });
  });

  describe('布局锁定', () => {
    it('布局锁定时容器应有 layout-locked 类', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createContainerNode('horizontal', [
            createPaneNode('connections', 'child-1'),
            createPaneNode('commandBar', 'child-2'),
          ]),
          layoutLocked: true,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.find('.layout-locked').exists()).toBe(true);
    });

    it('布局未锁定时容器不应有 layout-locked 类', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createContainerNode('horizontal', [
            createPaneNode('connections', 'child-1'),
            createPaneNode('commandBar', 'child-2'),
          ]),
          layoutLocked: false,
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.find('.layout-locked').exists()).toBe(false);
    });
  });

  describe('递归渲染', () => {
    it('应正确递归渲染嵌套布局', () => {
      const nestedLayout = createContainerNode(
        'horizontal',
        [
          createContainerNode(
            'vertical',
            [createPaneNode('connections', 'nested-1'), createPaneNode('commandBar', 'nested-2')],
            'inner-container'
          ),
          createPaneNode('editor', 'outer-pane'),
        ],
        'outer-container'
      );

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: nestedLayout,
        },
        global: { stubs: globalStubs },
      });

      // 应该有 splitpanes
      expect(wrapper.findComponent({ name: 'Splitpanes' }).exists()).toBe(true);
    });
  });

  describe('面板标签与图标', () => {
    it('左侧边栏应渲染面板按钮', async () => {
      mockLayoutStore.sidebarPanes = {
        left: ['connections', 'fileManager', 'dockerManager'],
        right: [],
      };

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          isRootRenderer: true,
        },
        global: { stubs: globalStubs },
      });

      await nextTick();

      // 检查按钮存在
      const buttons = wrapper.findAll('button');
      expect(buttons.length).toBeGreaterThan(0);
    });

    it('应为不同面板返回正确的图标', async () => {
      mockLayoutStore.sidebarPanes = {
        left: ['connections', 'fileManager', 'dockerManager', 'aiAssistant'],
        right: [],
      };

      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('terminal'),
          isRootRenderer: true,
        },
        global: { stubs: globalStubs },
      });

      await nextTick();

      // 检查图标类
      expect(wrapper.find('.fa-network-wired').exists()).toBe(true);
      expect(wrapper.find('.fa-folder-open').exists()).toBe(true);
      expect(wrapper.find('.fa-docker').exists()).toBe(true);
      expect(wrapper.find('.fa-robot').exists()).toBe(true);
    });
  });

  describe('样式', () => {
    it('根容器应有正确的样式类', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
        },
        global: { stubs: globalStubs },
      });

      const root = wrapper.find('.relative.flex.h-full.w-full.overflow-hidden');
      expect(root.exists()).toBe(true);
    });
  });

  describe('节点类型处理', () => {
    it('应正确处理 pane 类型节点', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createPaneNode('connections'),
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('layoutNode').type).toBe('pane');
    });

    it('应正确处理 container 类型节点', () => {
      const wrapper = shallowMount(LayoutRenderer, {
        props: {
          layoutNode: createContainerNode('horizontal', [createPaneNode('connections', 'child-1')]),
        },
        global: { stubs: globalStubs },
      });

      expect(wrapper.props('layoutNode').type).toBe('container');
    });
  });
});
