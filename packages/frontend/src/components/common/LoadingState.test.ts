/**
 * LoadingState.vue 单元测试
 * 验证统一加载状态组件的渲染、文案与无障碍属性
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import LoadingState from './LoadingState.vue';

// Mock vue-i18n：返回 key 本身，便于断言
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

describe('LoadingState.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认渲染 spinner 与 common.loading 文案', () => {
    const wrapper = mount(LoadingState);
    expect(wrapper.find('.fa-spinner.fa-spin').exists()).toBe(true);
    expect(wrapper.text()).toContain('common.loading');
  });

  it('传入自定义 text 时优先显示自定义文案', () => {
    const wrapper = mount(LoadingState, {
      props: { text: '正在加载标签...' },
    });
    expect(wrapper.text()).toContain('正在加载标签...');
    expect(wrapper.text()).not.toContain('common.loading');
  });

  it('compact 模式使用紧凑间距类', () => {
    const wrapper = mount(LoadingState, {
      props: { compact: true },
    });
    expect(wrapper.classes()).toContain('p-3');
    expect(wrapper.classes()).toContain('text-xs');
    expect(wrapper.classes()).not.toContain('p-6');
  });

  it('full 模式添加 h-full 类', () => {
    const wrapper = mount(LoadingState, {
      props: { full: true },
    });
    expect(wrapper.classes()).toContain('h-full');
  });

  it('应包含无障碍角色与 sr-only 文本', () => {
    const wrapper = mount(LoadingState, {
      props: { text: '加载中' },
    });
    expect(wrapper.attributes('role')).toBe('status');
    expect(wrapper.attributes('aria-live')).toBe('polite');
    expect(wrapper.find('.sr-only').text()).toBe('加载中');
  });
});
