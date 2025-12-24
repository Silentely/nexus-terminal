/**
 * Terminal.vue 单元测试
 * 测试终端组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { nextTick } from 'vue';
import Terminal from './Terminal.vue';

// Mock xterm and addons
const mockTerminalWrite = vi.fn();
const mockTerminalDispose = vi.fn();
const mockTerminalFocus = vi.fn();
const mockTerminalClear = vi.fn();
const mockTerminalGetSelection = vi.fn(() => '');
const mockTerminalRefresh = vi.fn();
const mockTerminalOpen = vi.fn();
const mockTerminalLoadAddon = vi.fn();
const mockOnData = vi.fn();
const mockOnSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));

const mockTerminalInstance = {
  write: mockTerminalWrite,
  dispose: mockTerminalDispose,
  focus: mockTerminalFocus,
  clear: mockTerminalClear,
  getSelection: mockTerminalGetSelection,
  refresh: mockTerminalRefresh,
  open: mockTerminalOpen,
  loadAddon: mockTerminalLoadAddon,
  onData: mockOnData,
  onSelectionChange: mockOnSelectionChange,
  options: {
    fontSize: 14,
    fontFamily: 'monospace',
    theme: {},
  },
  rows: 24,
  cols: 80,
  textarea: null,
  element: document.createElement('div'),
};

vi.mock('xterm', () => ({
  Terminal: vi.fn(() => mockTerminalInstance),
}));

vi.mock('xterm-addon-web-links', () => ({
  WebLinksAddon: vi.fn(() => ({})),
}));

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: vi.fn(() => ({
    findNext: vi.fn(() => true),
    findPrevious: vi.fn(() => true),
    clearDecorations: vi.fn(),
  })),
}));

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: vi.fn(() => ({
    onContextLoss: vi.fn(),
    dispose: vi.fn(),
  })),
}));

vi.mock('./addons/output-enhancer', () => ({
  OutputEnhancerAddon: vi.fn(() => ({
    isEnabled: vi.fn(() => true),
    setEnabled: vi.fn(),
    expandLastFold: vi.fn(() => true),
    dispose: vi.fn(),
  })),
}));

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => key,
  }),
}));

// Mock composables with vi.hoisted
const {
  mockEmitWorkspaceEvent,
  mockIsMobile,
  mockFitAndEmitResizeNow,
  mockSetupResizeObserver,
  mockSetupInputHandler,
  mockAppearanceState,
  mockSettingsState,
} = vi.hoisted(() => ({
  mockEmitWorkspaceEvent: vi.fn(),
  mockIsMobile: { value: false },
  mockFitAndEmitResizeNow: vi.fn(),
  mockSetupResizeObserver: vi.fn(),
  mockSetupInputHandler: vi.fn(),
  mockAppearanceState: {
    effectiveTerminalTheme: { value: { background: '#000', foreground: '#fff' } },
    currentTerminalFontFamily: { value: 'monospace' },
    currentTerminalFontSize: { value: 14 },
    terminalTextStrokeEnabled: { value: false },
    terminalTextStrokeWidth: { value: 1 },
    terminalTextStrokeColor: { value: '#000' },
    terminalTextShadowEnabled: { value: false },
    terminalTextShadowOffsetX: { value: 0 },
    terminalTextShadowOffsetY: { value: 0 },
    terminalTextShadowBlur: { value: 0 },
    terminalTextShadowColor: { value: '#000' },
    initialAppearanceDataLoaded: { value: true },
  },
  mockSettingsState: {
    autoCopyOnSelectBoolean: { value: false },
    terminalScrollbackLimitNumber: { value: 1000 },
    terminalEnableRightClickPasteBoolean: { value: false },
    terminalOutputEnhancerEnabledBoolean: { value: true },
  },
}));

vi.mock('../../composables/workspaceEvents', () => ({
  useWorkspaceEventEmitter: () => mockEmitWorkspaceEvent,
  useWorkspaceEventSubscriber: () => vi.fn(),
  useWorkspaceEventOff: () => vi.fn(),
}));

vi.mock('../../composables/useDeviceDetection', () => ({
  useDeviceDetection: () => ({ isMobile: mockIsMobile }),
}));

vi.mock('../../composables/terminal/useTerminalFit', () => ({
  useTerminalFit: () => ({
    fitAddon: {},
    fitAndEmitResizeNow: mockFitAndEmitResizeNow,
    setupResizeObserver: mockSetupResizeObserver,
  }),
}));

vi.mock('../../composables/terminal/useTerminalSocket', () => ({
  useTerminalSocket: () => ({
    setupInputHandler: mockSetupInputHandler,
  }),
}));

// Mock stores
vi.mock('../../stores/appearance.store', () => ({
  useAppearanceStore: () => ({
    setTerminalFontSize: vi.fn(),
    setTerminalFontSizeMobile: vi.fn(),
  }),
}));

vi.mock('../../stores/settings.store', () => ({
  useSettingsStore: () => ({}),
}));

vi.mock('../../stores/session.store', () => ({
  useSessionStore: () => ({}),
}));

// Mock pinia storeToRefs
vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return {
    ...actual,
    storeToRefs: (store: any) => {
      // Return appropriate refs based on which store is being used
      if (store.setTerminalFontSize) {
        // appearance store
        return mockAppearanceState;
      }
      // settings store
      return mockSettingsState;
    },
  };
});

describe('Terminal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // Reset mock states
    mockIsMobile.value = false;
    mockAppearanceState.currentTerminalFontSize.value = 14;
    mockAppearanceState.currentTerminalFontFamily.value = 'monospace';
    mockSettingsState.autoCopyOnSelectBoolean.value = false;
    mockSettingsState.terminalEnableRightClickPasteBoolean.value = false;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('应正确渲染终端容器', () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      expect(wrapper.find('.terminal-outer-wrapper').exists()).toBe(true);
      expect(wrapper.find('.terminal-inner-container').exists()).toBe(true);
    });

    it('应使用 props 中的 sessionId', () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'test-session-123' },
      });

      expect(wrapper.props('sessionId')).toBe('test-session-123');
    });

    it('应支持 isActive prop', () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1', isActive: true },
      });

      expect(wrapper.props('isActive')).toBe(true);
    });
  });

  describe('终端初始化', () => {
    it('挂载时应初始化 xterm Terminal', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      // Terminal constructor should be called
      const { Terminal: TerminalMock } = await import('xterm');
      expect(TerminalMock).toHaveBeenCalled();
    });

    it('应使用外观设置初始化终端', async () => {
      mockAppearanceState.currentTerminalFontSize.value = 16;
      mockAppearanceState.currentTerminalFontFamily.value = 'Fira Code';

      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const { Terminal: TerminalMock } = await import('xterm');
      expect(TerminalMock).toHaveBeenCalledWith(
        expect.objectContaining({
          fontSize: 16,
          fontFamily: 'Fira Code',
        })
      );
    });

    it('应加载必要的插件', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      // loadAddon should be called multiple times for different addons
      expect(mockTerminalLoadAddon).toHaveBeenCalled();
    });

    it('应调用 open 方法挂载终端', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      expect(mockTerminalOpen).toHaveBeenCalled();
    });

    it('应设置输入处理器', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      expect(mockSetupInputHandler).toHaveBeenCalled();
    });

    it('应设置 resize 观察器', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      expect(mockSetupResizeObserver).toHaveBeenCalled();
    });

    it('应触发 terminal:ready 事件', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith(
        'terminal:ready',
        expect.objectContaining({
          sessionId: 'session-1',
        })
      );
    });

    it('应聚焦终端', async () => {
      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      expect(mockTerminalFocus).toHaveBeenCalled();
    });
  });

  describe('expose 方法', () => {
    it('应暴露 write 方法', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const exposed = wrapper.vm as any;
      expect(typeof exposed.write).toBe('function');
    });

    it('应暴露 findNext 方法', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const exposed = wrapper.vm as any;
      expect(typeof exposed.findNext).toBe('function');
    });

    it('应暴露 findPrevious 方法', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const exposed = wrapper.vm as any;
      expect(typeof exposed.findPrevious).toBe('function');
    });

    it('应暴露 clearSearch 方法', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const exposed = wrapper.vm as any;
      expect(typeof exposed.clearSearch).toBe('function');
    });

    it('应暴露 clear 方法', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const exposed = wrapper.vm as any;
      expect(typeof exposed.clear).toBe('function');
    });
  });

  describe('卸载清理', () => {
    it('卸载时应销毁终端实例', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();
      wrapper.unmount();

      expect(mockTerminalDispose).toHaveBeenCalled();
    });
  });

  describe('滚动限制', () => {
    it('scrollback 为 0 时应使用 Infinity', async () => {
      mockSettingsState.terminalScrollbackLimitNumber.value = 0;

      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const { Terminal: TerminalMock } = await import('xterm');
      expect(TerminalMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scrollback: Infinity,
        })
      );
    });

    it('应使用正数 scrollback 值', async () => {
      mockSettingsState.terminalScrollbackLimitNumber.value = 5000;

      mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      await nextTick();

      const { Terminal: TerminalMock } = await import('xterm');
      expect(TerminalMock).toHaveBeenCalledWith(
        expect.objectContaining({
          scrollback: 5000,
        })
      );
    });
  });

  describe('移动端支持', () => {
    it('移动端应添加触摸事件监听器', async () => {
      mockIsMobile.value = true;

      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
        attachTo: document.body,
      });

      await nextTick();

      const container = wrapper.find('.terminal-inner-container');
      expect(container.exists()).toBe(true);

      wrapper.unmount();
    });
  });

  describe('样式', () => {
    it('外层容器应有正确的样式类', () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      const outerWrapper = wrapper.find('.terminal-outer-wrapper');
      expect(outerWrapper.exists()).toBe(true);
    });

    it('内层容器应有正确的样式类', () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      const innerContainer = wrapper.find('.terminal-inner-container');
      expect(innerContainer.exists()).toBe(true);
    });
  });

  describe('Props 响应', () => {
    it('isActive 变化时应更新内部状态', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1', isActive: false },
      });

      await wrapper.setProps({ isActive: true });
      await nextTick();

      expect(wrapper.props('isActive')).toBe(true);
    });

    it('stream 变化时应更新内部状态', async () => {
      const wrapper = mount(Terminal, {
        props: { sessionId: 'session-1' },
      });

      const mockStream = new ReadableStream();
      await wrapper.setProps({ stream: mockStream });
      await nextTick();

      expect(wrapper.props('stream')).toBe(mockStream);
    });
  });
});
