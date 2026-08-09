/**
 * AlertDialog 组件测试
 * 验证无障碍：安全 id（非标题文本）、打开聚焦、Escape 关闭
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick } from 'vue';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

import AlertDialog from './AlertDialog.vue';

describe('AlertDialog.vue', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mountDialog = (props = {}) =>
    mount(AlertDialog, {
      props: { visible: true, title: '操作失败', message: '请稍后重试', ...props },
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
    expect(titleId).not.toContain('操作失败');
    expect(dialog.attributes('aria-labelledby')).toBe(titleId);
    wrapper.unmount();
  });

  it('打开时应聚焦到确定按钮', async () => {
    const wrapper = mountDialog();
    await flush();

    const okBtn = wrapper.find('button').element;
    expect(document.activeElement).toBe(okBtn);
    wrapper.unmount();
  });

  it('Escape 应触发确定', async () => {
    const wrapper = mountDialog();
    await flush();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(wrapper.emitted('ok')).toBeTruthy();
    wrapper.unmount();
  });
});
