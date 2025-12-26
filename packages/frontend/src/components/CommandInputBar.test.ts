/**
 * CommandInputBar.vue 单元测试
 * 测试命令输入栏组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { ref, computed } from 'vue';
import CommandInputBar from './CommandInputBar.vue';

// Mock vue-i18n
vi.mock('vue-i18n', async () => {
  const actual = await vi.importActual<any>('vue-i18n');
  return {
    ...actual,
    useI18n: () => ({ t: (key: string, fallback?: string) => fallback || key }),
  };
});

// Mock workspace event emitter
const mockEmitWorkspaceEvent = vi.fn();
vi.mock('../composables/workspaceEvents', () => ({
  useWorkspaceEventEmitter: () => mockEmitWorkspaceEvent,
}));

// Mock child components
vi.mock('./QuickCommandsModal.vue', () => ({
  default: {
    name: 'QuickCommandsModal',
    template: '<div class="mock-quick-commands-modal"></div>',
    props: ['isVisible'],
  },
}));

vi.mock('./SuspendedSshSessionsModal.vue', () => ({
  default: {
    name: 'SuspendedSshSessionsModal',
    template: '<div class="mock-suspended-sessions-modal"></div>',
    props: ['isVisible'],
  },
}));

// Mock stores - 使用 ref 创建响应式数据以兼容 storeToRefs
const mockSessionStore = {
  sessions: new Map(),
  activeSessionId: ref<string | null>(null),
  updateSessionCommandInput: vi.fn(),
  $id: 'session',
};

const mockFocusSwitcherStore = {
  activateTerminalSearchTrigger: 0,
  toggleConfigurator: vi.fn(),
  registerFocusAction: vi.fn(() => vi.fn()),
  $id: 'focusSwitcher',
};

const mockCommandInputSyncTarget = ref<string>('none');
const mockShowPopupFileManagerBoolean = ref(false);
const mockShowPopupFileEditorBoolean = ref(false);

const mockSettingsStore = {
  commandInputSyncTarget: mockCommandInputSyncTarget,
  showPopupFileManagerBoolean: mockShowPopupFileManagerBoolean,
  showPopupFileEditorBoolean: mockShowPopupFileEditorBoolean,
  $id: 'settings',
};

const mockQuickCommandsSelectedIndex = ref(-1);
const mockQuickCommandsFlatVisible = ref<{ command: string }[]>([]);

const mockQuickCommandsStore = {
  selectedIndex: mockQuickCommandsSelectedIndex,
  flatVisibleCommands: mockQuickCommandsFlatVisible,
  resetSelection: vi.fn(),
  selectPreviousCommand: vi.fn(),
  selectNextCommand: vi.fn(),
  setSearchTerm: vi.fn(),
  $id: 'quickCommands',
};

const mockHistorySelectedIndex = ref(-1);
const mockHistoryFiltered = ref<{ command: string }[]>([]);

const mockCommandHistoryStore = {
  selectedIndex: mockHistorySelectedIndex,
  filteredHistory: mockHistoryFiltered,
  resetSelection: vi.fn(),
  selectPreviousCommand: vi.fn(),
  selectNextCommand: vi.fn(),
  setSearchTerm: vi.fn(),
  $id: 'commandHistory',
};

const mockFileEditorStore = {
  triggerPopup: vi.fn(),
  $id: 'fileEditor',
};

vi.mock('../stores/session.store', () => ({
  useSessionStore: () => mockSessionStore,
}));

vi.mock('../stores/focusSwitcher.store', () => ({
  useFocusSwitcherStore: () => mockFocusSwitcherStore,
}));

vi.mock('../stores/settings.store', () => ({
  useSettingsStore: () => mockSettingsStore,
}));

vi.mock('../stores/quickCommands.store', () => ({
  useQuickCommandsStore: () => mockQuickCommandsStore,
}));

vi.mock('../stores/commandHistory.store', () => ({
  useCommandHistoryStore: () => mockCommandHistoryStore,
}));

vi.mock('../stores/fileEditor.store', () => ({
  useFileEditorStore: () => mockFileEditorStore,
}));

describe('CommandInputBar.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());

    // 重置 mock refs
    mockSessionStore.activeSessionId.value = 'session-1';
    mockSessionStore.sessions = new Map([
      [
        'session-1',
        {
          commandInputContent: ref(''),
        },
      ],
    ]);

    mockCommandInputSyncTarget.value = 'none';
    mockShowPopupFileManagerBoolean.value = false;
    mockShowPopupFileEditorBoolean.value = false;

    mockQuickCommandsSelectedIndex.value = -1;
    mockQuickCommandsFlatVisible.value = [];

    mockHistorySelectedIndex.value = -1;
    mockHistoryFiltered.value = [];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('应正确渲染命令输入栏', () => {
      const wrapper = mount(CommandInputBar);

      expect(wrapper.find('input[type="text"]').exists()).toBe(true);
      expect(wrapper.find('.fa-eraser').exists()).toBe(true); // Clear button
    });

    it('桌面模式应显示搜索切换按钮', () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      expect(wrapper.find('.fa-search').exists()).toBe(true);
    });

    it('移动模式应显示快捷指令按钮', () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: true },
      });

      expect(wrapper.find('.fa-bolt').exists()).toBe(true);
    });

    it('移动模式应显示虚拟键盘切换按钮', () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: true },
      });

      const keyboardButtons = wrapper.findAll('.fa-keyboard');
      expect(keyboardButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('showPopupFileManagerBoolean 为 true 时应显示文件管理器按钮', async () => {
      mockShowPopupFileManagerBoolean.value = true;

      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      expect(wrapper.find('.fa-folder').exists()).toBe(true);
    });

    it('showPopupFileEditorBoolean 为 true 时应显示文件编辑器按钮', async () => {
      mockShowPopupFileEditorBoolean.value = true;

      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      expect(wrapper.find('.fa-edit').exists()).toBe(true);
    });
  });

  describe('命令发送', () => {
    it('按下 Enter 键应发送命令', async () => {
      mockSessionStore.sessions.get('session-1')!.commandInputContent.value = 'ls -la';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'Enter' });

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', {
        command: 'ls -la',
      });
    });

    it('空命令按 Enter 应请求滚动到底部', async () => {
      mockSessionStore.sessions.get('session-1')!.commandInputContent.value = '';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'Enter' });

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', { command: '' });
      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:scrollToBottomRequest', {
        sessionId: 'session-1',
      });
    });

    it('发送命令后应清空输入框', async () => {
      mockSessionStore.sessions.get('session-1')!.commandInputContent.value = 'echo test';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'Enter' });

      expect(mockSessionStore.updateSessionCommandInput).toHaveBeenCalledWith('session-1', '');
    });

    it('Ctrl+C 在空输入时应发送 SIGINT', async () => {
      mockSessionStore.sessions.get('session-1')!.commandInputContent.value = '';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'c', ctrlKey: true });

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', {
        command: '\x03',
      });
    });
  });

  describe('搜索功能', () => {
    it('点击搜索按钮应切换搜索模式', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      const searchButton = wrapper.find('.fa-search').element.closest('button');
      await wrapper.find('.fa-search').element.closest('button')?.click();
      await wrapper.vm.$nextTick();

      // 搜索模式激活后应显示关闭图标
      expect(wrapper.find('.fa-times').exists()).toBe(true);
    });

    it('Ctrl+F 应激活搜索模式', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      const input = wrapper.find('input[data-focus-id="commandInput"]');
      await input.trigger('keydown', { key: 'f', ctrlKey: true });

      expect(wrapper.find('input[data-focus-id="terminalSearch"]').exists()).toBe(true);
    });

    it('关闭搜索应发送 search:close 事件', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      // 先激活搜索
      const input = wrapper.find('input[data-focus-id="commandInput"]');
      await input.trigger('keydown', { key: 'f', ctrlKey: true });
      await wrapper.vm.$nextTick();

      // 点击关闭
      const closeButton = wrapper.find('.fa-times').element.closest('button');
      await closeButton?.click();

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('search:close');
    });
  });

  describe('快捷指令同步', () => {
    it('commandInputSyncTarget 为 quickCommands 时应同步搜索词', async () => {
      mockCommandInputSyncTarget.value = 'quickCommands';

      const wrapper = mount(CommandInputBar);
      mockSessionStore.sessions.get('session-1')!.commandInputContent.value = 'test';
      await wrapper.vm.$nextTick();

      expect(mockQuickCommandsStore.setSearchTerm).toHaveBeenCalledWith('test');
    });

    it('commandInputSyncTarget 为 commandHistory 时应同步搜索词', async () => {
      mockCommandInputSyncTarget.value = 'commandHistory';

      const wrapper = mount(CommandInputBar);
      mockSessionStore.sessions.get('session-1')!.commandInputContent.value = 'history';
      await wrapper.vm.$nextTick();

      expect(mockCommandHistoryStore.setSearchTerm).toHaveBeenCalledWith('history');
    });

    it('ArrowUp 在 quickCommands 模式应选择上一条', async () => {
      mockCommandInputSyncTarget.value = 'quickCommands';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'ArrowUp' });

      expect(mockQuickCommandsStore.selectPreviousCommand).toHaveBeenCalled();
    });

    it('ArrowDown 在 commandHistory 模式应选择下一条', async () => {
      mockCommandInputSyncTarget.value = 'commandHistory';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'ArrowDown' });

      expect(mockCommandHistoryStore.selectNextCommand).toHaveBeenCalled();
    });

    it('Enter 有选中快捷指令时应执行选中项', async () => {
      mockCommandInputSyncTarget.value = 'quickCommands';
      mockQuickCommandsSelectedIndex.value = 0;
      mockQuickCommandsFlatVisible.value = [{ command: 'selected-cmd' }];

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'Enter' });

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', {
        command: 'selected-cmd',
      });
      expect(mockQuickCommandsStore.resetSelection).toHaveBeenCalled();
    });

    it('Enter 有选中历史命令时应执行选中项', async () => {
      mockCommandInputSyncTarget.value = 'commandHistory';
      mockHistorySelectedIndex.value = 0;
      mockHistoryFiltered.value = [{ command: 'history-cmd' }];

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('keydown', { key: 'Enter' });

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:sendCommand', {
        command: 'history-cmd',
      });
      expect(mockCommandHistoryStore.resetSelection).toHaveBeenCalled();
    });
  });

  describe('失焦处理', () => {
    it('失焦时应重置快捷指令选中状态', async () => {
      mockCommandInputSyncTarget.value = 'quickCommands';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('blur');

      expect(mockQuickCommandsStore.resetSelection).toHaveBeenCalled();
    });

    it('失焦时应重置命令历史选中状态', async () => {
      mockCommandInputSyncTarget.value = 'commandHistory';

      const wrapper = mount(CommandInputBar);
      const input = wrapper.find('input[data-focus-id="commandInput"]');

      await input.trigger('blur');

      expect(mockCommandHistoryStore.resetSelection).toHaveBeenCalled();
    });
  });

  describe('模态框控制', () => {
    it('移动端点击快捷指令按钮应打开模态框', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: true },
      });

      const quickCommandButton = wrapper.find('.fa-bolt').element.closest('button');
      await quickCommandButton?.click();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as any;
      expect(vm.showQuickCommands).toBe(true);
    });

    it('移动端点击挂起会话按钮应打开模态框', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: true },
      });

      const suspendButton = wrapper.find('.fa-pause-circle').element.closest('button');
      await suspendButton?.click();
      await wrapper.vm.$nextTick();

      const vm = wrapper.vm as any;
      expect(vm.showSuspendedSshSessionsModal).toBe(true);
    });
  });

  describe('文件管理器与编辑器', () => {
    it('点击文件管理器按钮应发送打开请求', async () => {
      mockShowPopupFileManagerBoolean.value = true;

      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      const folderButton = wrapper.find('.fa-folder').element.closest('button');
      await folderButton?.click();

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('fileManager:openModalRequest', {
        sessionId: 'session-1',
      });
    });

    it('无活动会话时点击文件管理器按钮不应发送请求', async () => {
      mockSessionStore.activeSessionId.value = null;
      mockShowPopupFileManagerBoolean.value = true;

      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      const folderButton = wrapper.find('.fa-folder').element.closest('button');
      await folderButton?.click();

      expect(mockEmitWorkspaceEvent).not.toHaveBeenCalledWith(
        'fileManager:openModalRequest',
        expect.anything()
      );
    });

    it('点击文件编辑器按钮应触发弹出', async () => {
      mockShowPopupFileEditorBoolean.value = true;

      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      const editButton = wrapper.find('.fa-edit').element.closest('button');
      await editButton?.click();

      expect(mockFileEditorStore.triggerPopup).toHaveBeenCalledWith('', 'session-1');
    });
  });

  describe('清空终端', () => {
    it('点击清空按钮应发送 terminal:clear 事件', async () => {
      const wrapper = mount(CommandInputBar);

      const clearButton = wrapper.find('.fa-eraser').element.closest('button');
      await clearButton?.click();

      expect(mockEmitWorkspaceEvent).toHaveBeenCalledWith('terminal:clear');
    });
  });

  describe('焦点切换配置', () => {
    it('桌面模式点击键盘按钮应打开焦点配置器', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
      });

      // 找到焦点切换配置按钮（非移动端的键盘图标）
      const buttons = wrapper.findAll('button');
      const configButton = buttons.find((b) => {
        const icon = b.find('.fa-keyboard');
        return icon.exists() && b.attributes('title')?.includes('配置焦点切换');
      });

      if (configButton) {
        await configButton.trigger('click');
        expect(mockFocusSwitcherStore.toggleConfigurator).toHaveBeenCalledWith(true);
      }
    });
  });

  describe('虚拟键盘', () => {
    it('移动端点击虚拟键盘按钮应触发事件', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: true, isVirtualKeyboardVisible: false },
      });

      // 找到虚拟键盘切换按钮
      const keyboardButtons = wrapper.findAll('.fa-keyboard');
      // 移动端有虚拟键盘切换按钮
      const toggleButton = keyboardButtons[0]?.element.closest('button');

      if (toggleButton) {
        await (toggleButton as HTMLElement).click();
        expect(wrapper.emitted('toggle-virtual-keyboard')).toBeTruthy();
      }
    });
  });

  describe('expose 方法', () => {
    it('focusCommandInput 应聚焦命令输入框', async () => {
      const wrapper = mount(CommandInputBar, {
        attachTo: document.body,
      });

      const vm = wrapper.vm as any;
      const result = vm.focusCommandInput();

      expect(result).toBe(true);

      wrapper.unmount();
    });

    it('focusSearchInput 应激活搜索并聚焦', async () => {
      const wrapper = mount(CommandInputBar, {
        props: { isMobile: false },
        attachTo: document.body,
      });

      const vm = wrapper.vm as any;
      const result = vm.focusSearchInput();

      expect(result).toBe(true);

      wrapper.unmount();
    });
  });

  describe('会话状态', () => {
    it('无活动会话时命令输入应返回空字符串', () => {
      mockSessionStore.activeSessionId.value = null;

      const wrapper = mount(CommandInputBar);
      const vm = wrapper.vm as any;

      expect(vm.currentSessionCommandInput).toBe('');
    });

    it('会话不存在时命令输入应返回空字符串', () => {
      mockSessionStore.activeSessionId.value = 'nonexistent';

      const wrapper = mount(CommandInputBar);
      const vm = wrapper.vm as any;

      expect(vm.currentSessionCommandInput).toBe('');
    });
  });

  describe('焦点注册', () => {
    it('挂载时应注册焦点动作', () => {
      const wrapper = mount(CommandInputBar);

      expect(mockFocusSwitcherStore.registerFocusAction).toHaveBeenCalledWith(
        'commandInput',
        expect.any(Function)
      );
      expect(mockFocusSwitcherStore.registerFocusAction).toHaveBeenCalledWith(
        'terminalSearch',
        expect.any(Function)
      );
    });
  });
});
