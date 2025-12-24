/**
 * MonacoEditor.vue 单元测试
 * 测试 Monaco 编辑器封装组件的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';
import { editor, createMockEditorInstance } from 'monaco-editor';
import MonacoEditor from './MonacoEditor.vue';

// 获取 mock 实例的辅助函数
function getLastEditorInstance() {
  const createMock = editor.create as ReturnType<typeof vi.fn>;
  const calls = createMock.mock.results;
  if (calls.length > 0) {
    return calls[calls.length - 1].value;
  }
  return null;
}

describe('MonacoEditor.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('渲染测试', () => {
    it('应正确渲染编辑器容器', () => {
      const wrapper = mount(MonacoEditor, {
        props: {
          modelValue: 'test content',
        },
      });

      expect(wrapper.find('.monaco-editor-container').exists()).toBe(true);
    });

    it('应使用默认 props 值', () => {
      const wrapper = mount(MonacoEditor);

      expect(wrapper.props('modelValue')).toBe('');
      expect(wrapper.props('language')).toBe('plaintext');
      expect(wrapper.props('theme')).toBe('vs-dark');
      expect(wrapper.props('readOnly')).toBe(false);
      expect(wrapper.props('fontSize')).toBe(14);
    });

    it('应接受自定义 props', () => {
      const wrapper = mount(MonacoEditor, {
        props: {
          modelValue: 'custom content',
          language: 'typescript',
          theme: 'vs-light',
          readOnly: true,
          fontSize: 16,
          fontFamily: 'Fira Code',
        },
      });

      expect(wrapper.props('modelValue')).toBe('custom content');
      expect(wrapper.props('language')).toBe('typescript');
      expect(wrapper.props('theme')).toBe('vs-light');
      expect(wrapper.props('readOnly')).toBe(true);
      expect(wrapper.props('fontSize')).toBe(16);
      expect(wrapper.props('fontFamily')).toBe('Fira Code');
    });
  });

  describe('编辑器初始化', () => {
    it('挂载时应创建 Monaco 编辑器实例', async () => {
      mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      expect(editor.create).toHaveBeenCalled();
    });

    it('应使用正确的配置创建编辑器', async () => {
      mount(MonacoEditor, {
        props: {
          modelValue: 'test content',
          language: 'javascript',
          theme: 'vs-dark',
          fontSize: 16,
          fontFamily: 'Consolas',
          readOnly: true,
        },
      });

      await nextTick();

      expect(editor.create).toHaveBeenCalledWith(
        expect.any(HTMLElement),
        expect.objectContaining({
          value: 'test content',
          language: 'javascript',
          theme: 'vs-dark',
          fontSize: 16,
          fontFamily: 'Consolas',
          readOnly: true,
          automaticLayout: true,
        })
      );
    });

    it('应注册内容变更监听器', async () => {
      mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      expect(instance?.onDidChangeModelContent).toHaveBeenCalled();
    });

    it('应注册滚动变更监听器', async () => {
      mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      expect(instance?.onDidScrollChange).toHaveBeenCalled();
    });

    it('应注册保存快捷键动作', async () => {
      mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      expect(instance?.addAction).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'save-file',
          label: 'Save File',
        })
      );
    });
  });

  describe('Props 响应', () => {
    it('modelValue 变化时应更新编辑器内容', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'initial' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      instance.getValue.mockReturnValue('initial');

      await wrapper.setProps({ modelValue: 'updated content' });
      await nextTick();

      expect(instance.setValue).toHaveBeenCalledWith('updated content');
    });

    it('language 变化时应更新编辑器语言', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test', language: 'javascript' },
      });

      await nextTick();

      await wrapper.setProps({ language: 'typescript' });
      await nextTick();

      expect(editor.setModelLanguage).toHaveBeenCalledWith(expect.anything(), 'typescript');
    });

    it('theme 变化时应更新编辑器主题', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test', theme: 'vs-dark' },
      });

      await nextTick();

      await wrapper.setProps({ theme: 'vs-light' });
      await nextTick();

      expect(editor.setTheme).toHaveBeenCalledWith('vs-light');
    });

    it('readOnly 变化时应更新编辑器选项', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test', readOnly: false },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      await wrapper.setProps({ readOnly: true });
      await nextTick();

      expect(instance.updateOptions).toHaveBeenCalledWith({ readOnly: true });
    });

    it('fontFamily 变化时应更新编辑器选项', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test', fontFamily: 'Consolas' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      await wrapper.setProps({ fontFamily: 'Fira Code' });
      await nextTick();

      expect(instance.updateOptions).toHaveBeenCalledWith({ fontFamily: 'Fira Code' });
    });

    it('fontSize 变化时应更新编辑器选项', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test', fontSize: 14 },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      await wrapper.setProps({ fontSize: 18 });
      await nextTick();

      expect(instance.updateOptions).toHaveBeenCalledWith({ fontSize: 18 });
    });
  });

  describe('事件发射', () => {
    it('内容变化时应发射 update:modelValue 事件', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'initial' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      // 模拟内容变化回调
      const contentChangeCallback = instance.onDidChangeModelContent.mock.calls[0][0];
      instance.getValue.mockReturnValue('new content');
      contentChangeCallback();

      expect(wrapper.emitted('update:modelValue')).toBeTruthy();
      expect(wrapper.emitted('update:modelValue')![0]).toEqual(['new content']);
    });

    it('滚动变化时应发射 update:scrollPosition 事件', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      instance.getScrollTop.mockReturnValue(100);
      instance.getScrollLeft.mockReturnValue(50);

      // 模拟滚动变化回调
      const scrollChangeCallback = instance.onDidScrollChange.mock.calls[0][0];
      scrollChangeCallback({});

      expect(wrapper.emitted('update:scrollPosition')).toBeTruthy();
      expect(wrapper.emitted('update:scrollPosition')![0]).toEqual([
        { scrollTop: 100, scrollLeft: 50 },
      ]);
    });

    it('保存动作应发射 request-save 事件', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      // 找到保存动作并执行 run 方法
      const addActionCall = instance.addAction.mock.calls.find(
        (call: any[]) => call[0].id === 'save-file'
      );
      expect(addActionCall).toBeDefined();

      addActionCall[0].run();

      expect(wrapper.emitted('request-save')).toBeTruthy();
    });
  });

  describe('初始滚动位置', () => {
    it('应设置初始滚动位置', async () => {
      mount(MonacoEditor, {
        props: {
          modelValue: 'test',
          initialScrollTop: 200,
          initialScrollLeft: 100,
        },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      expect(instance.setScrollPosition).toHaveBeenCalledWith({
        scrollTop: 200,
        scrollLeft: 100,
      });
    });

    it('初始滚动位置为 0 时不应调用 setScrollPosition', async () => {
      mount(MonacoEditor, {
        props: {
          modelValue: 'test',
          initialScrollTop: 0,
          initialScrollLeft: 0,
        },
      });

      await nextTick();

      const instance = getLastEditorInstance();
      expect(instance.setScrollPosition).not.toHaveBeenCalled();
    });
  });

  describe('expose 方法', () => {
    it('应暴露 focus 方法', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();

      const exposed = wrapper.vm as any;
      expect(typeof exposed.focus).toBe('function');

      const instance = getLastEditorInstance();
      exposed.focus();
      expect(instance.focus).toHaveBeenCalled();
    });
  });

  describe('卸载清理', () => {
    it('卸载时应销毁编辑器实例', async () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      await nextTick();
      const instance = getLastEditorInstance();
      wrapper.unmount();

      expect(instance.dispose).toHaveBeenCalled();
    });
  });

  describe('样式', () => {
    it('容器应有正确的样式类', () => {
      const wrapper = mount(MonacoEditor, {
        props: { modelValue: 'test' },
      });

      const container = wrapper.find('.monaco-editor-container');
      expect(container.exists()).toBe(true);
    });
  });
});
