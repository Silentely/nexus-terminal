/**
 * ConfirmDialog 组件测试
 * 验证无障碍：安全 id（非标题文本）、打开聚焦、Tab 焦点圈闭、Escape 关闭
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import ConfirmDialog from './ConfirmDialog.vue';

describe('ConfirmDialog.vue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mountDialog = (props = {}) =>
    mount(ConfirmDialog, {
      props: { visible: true, title: '删除连接？', message: '此操作不可撤销', ...props },
      attachTo: document.body,
    });

  const flush = async () => {
    for (let i = 0; i < 8; i++) {
      await nextTick();
    }
  };

  it('对话框应使用安全 id 而非标题文本', () => {
    const wrapper = mountDialog();
    const dialog = wrapper.find('[role="dialog"]');
    const titleEl = wrapper.find('h3');
    const titleId = titleEl.attributes('id');

    expect(titleId).toBeDefined();
    // id 不应含中文/空格（标题为"删除连接？"）
    expect(titleId).not.toContain('删除');
    expect(dialog.attributes('aria-labelledby')).toBe(titleId);
    expect(titleEl.attributes('id')).toBe(titleId);
    wrapper.unmount();
  });

  it('打开时应聚焦到取消按钮', async () => {
    const wrapper = mountDialog();
    await flush();

    const cancelBtn = wrapper.find('button').element;
    expect(document.activeElement).toBe(cancelBtn);
    wrapper.unmount();
  });

  it('Tab 键应圈闭在对话框内', async () => {
    const wrapper = mountDialog();
    await flush();

    const buttons = wrapper.findAll('button');
    const first = buttons[0].element;
    const last = buttons[buttons.length - 1].element;

    // 聚焦第一个按钮后按 Shift+Tab 应回到最后一个
    first.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }));
    expect(document.activeElement).toBe(last);

    // 聚焦最后一个按钮后按 Tab 应回到第一个
    last.focus();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }));
    expect(document.activeElement).toBe(first);
    wrapper.unmount();
  });

  it('Escape 应触发取消', async () => {
    const wrapper = mountDialog();
    await flush();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('cancel')).toBeTruthy();
    wrapper.unmount();
  });
});
