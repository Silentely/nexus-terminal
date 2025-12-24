/**
 * QuickCommandsModal.vue 单元测试
 * 测试快捷指令模态框组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, VueWrapper } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import QuickCommandsModal from './QuickCommandsModal.vue';

// Mock workspace event subscriber
const mockEventHandlers = new Map<string, Function>();
vi.mock('../composables/workspaceEvents', () => ({
  useWorkspaceEventSubscriber: () => (event: string, handler: Function) => {
    mockEventHandlers.set(event, handler);
    return () => mockEventHandlers.delete(event);
  },
}));

// Mock QuickCommandsView component
vi.mock('../views/QuickCommandsView.vue', () => ({
  default: {
    name: 'QuickCommandsView',
    template:
      '<div class="mock-quick-commands-view" @click="$emit(\'execute-command\', \'test-cmd\')">Mock Commands</div>',
    emits: ['execute-command'],
  },
}));

describe('QuickCommandsModal.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    mockEventHandlers.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('渲染测试', () => {
    it('isVisible 为 false 时不应渲染模态框', () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: false },
      });

      expect(wrapper.find('.fixed').exists()).toBe(false);
    });

    it('isVisible 为 true 时应渲染模态框', () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      expect(wrapper.find('.fixed').exists()).toBe(true);
      expect(wrapper.text()).toContain('快捷指令');
    });

    it('应显示关闭按钮', () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      expect(wrapper.find('button[title="关闭"]').exists()).toBe(true);
    });

    it('应渲染 QuickCommandsView 子组件', () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      expect(wrapper.find('.mock-quick-commands-view').exists()).toBe(true);
    });
  });

  describe('关闭行为', () => {
    it('点击关闭按钮应触发 close 事件', async () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      const closeButton = wrapper.find('button[title="关闭"]');
      await closeButton.trigger('click');

      expect(wrapper.emitted('close')).toBeTruthy();
      expect(wrapper.emitted('close')?.length).toBe(1);
    });

    it('点击遮罩层应触发 close 事件', async () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      // 点击遮罩层（.fixed 背景）
      const overlay = wrapper.find('.fixed');
      await overlay.trigger('click');

      expect(wrapper.emitted('close')).toBeTruthy();
    });

    it('点击模态框内容不应关闭', async () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      // 点击模态框内容区域
      const content = wrapper.find('.bg-background');
      await content.trigger('click');

      // 由于 @click.self 只有点击自身才触发，点击子元素不应关闭
      expect(wrapper.emitted('close')).toBeFalsy();
    });

    it('按下 Escape 键应触发 close 事件', async () => {
      // 先挂载为 false，再切换为 true 以触发 watch
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: false },
        attachTo: document.body,
      });

      // 切换为可见状态，触发 watch 添加键盘监听器
      await wrapper.setProps({ isVisible: true });
      await wrapper.vm.$nextTick();

      // 模拟键盘事件
      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(wrapper.emitted('close')).toBeTruthy();

      wrapper.unmount();
    });

    it('isVisible 为 false 时按 Escape 不应有反应', async () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: false },
        attachTo: document.body,
      });

      const event = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(event);

      expect(wrapper.emitted('close')).toBeFalsy();

      wrapper.unmount();
    });
  });

  describe('命令执行', () => {
    it('子组件触发 execute-command 应向上传递并关闭', async () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      // 模拟子组件触发事件
      const mockView = wrapper.find('.mock-quick-commands-view');
      await mockView.trigger('click'); // 触发 mock 的 execute-command

      expect(wrapper.emitted('execute-command')).toBeTruthy();
      expect(wrapper.emitted('execute-command')?.[0]).toEqual(['test-cmd']);
      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('工作区事件监听', () => {
    it('应监听 terminal:sendCommand 事件', () => {
      mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      expect(mockEventHandlers.has('terminal:sendCommand')).toBe(true);
    });

    it('收到 terminal:sendCommand 事件应关闭模态框', async () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      // 模拟接收事件
      const handler = mockEventHandlers.get('terminal:sendCommand');
      if (handler) {
        handler();
      }

      expect(wrapper.emitted('close')).toBeTruthy();
    });
  });

  describe('可见性切换', () => {
    it('从隐藏变为可见时应添加键盘监听器', async () => {
      const addEventListenerSpy = vi.spyOn(document, 'addEventListener');

      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: false },
      });

      await wrapper.setProps({ isVisible: true });

      expect(addEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      addEventListenerSpy.mockRestore();
    });

    it('从可见变为隐藏时应移除键盘监听器', async () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      await wrapper.setProps({ isVisible: false });

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });
  });

  describe('卸载清理', () => {
    it('卸载时应移除键盘监听器', async () => {
      const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');

      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
        attachTo: document.body,
      });

      wrapper.unmount();

      expect(removeEventListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function));

      removeEventListenerSpy.mockRestore();
    });
  });

  describe('样式', () => {
    it('遮罩层应有正确的样式类', () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      const overlay = wrapper.find('.fixed');
      expect(overlay.classes()).toContain('inset-0');
      expect(overlay.classes()).toContain('bg-overlay');
      expect(overlay.classes()).toContain('z-50');
    });

    it('模态框容器应有正确的样式类', () => {
      const wrapper = mount(QuickCommandsModal, {
        props: { isVisible: true },
      });

      const content = wrapper.find('.bg-background');
      expect(content.classes()).toContain('rounded-lg');
      expect(content.classes()).toContain('shadow-xl');
    });
  });
});
