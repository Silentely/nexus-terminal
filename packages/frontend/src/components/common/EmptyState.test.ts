/**
 * EmptyState.vue 单元测试
 * 验证统一空状态组件的渲染、文案、图标与操作按钮
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import EmptyState from './EmptyState.vue';

describe('EmptyState.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('默认渲染文案与默认图标', () => {
    const wrapper = mount(EmptyState, {
      props: { text: '暂无数据' },
    });
    expect(wrapper.text()).toContain('暂无数据');
    expect(wrapper.find('i.fa-inbox').exists()).toBe(true);
  });

  it('自定义 icon 时使用传入的图标类', () => {
    const wrapper = mount(EmptyState, {
      props: { text: '暂无标签', icon: 'fa-tags' },
    });
    expect(wrapper.find('i.fa-tags').exists()).toBe(true);
    expect(wrapper.find('i.fa-inbox').exists()).toBe(false);
  });

  it('未传 actionText 时不渲染操作按钮', () => {
    const wrapper = mount(EmptyState, {
      props: { text: '空' },
    });
    expect(wrapper.find('button').exists()).toBe(false);
  });

  it('传入 actionText 时渲染按钮并触发 action 事件', async () => {
    const wrapper = mount(EmptyState, {
      props: { text: '空', actionText: '创建' },
    });
    const button = wrapper.find('button');
    expect(button.exists()).toBe(true);
    expect(button.text()).toBe('创建');
    await button.trigger('click');
    expect(wrapper.emitted('action')).toHaveLength(1);
  });

  it('full 模式添加 h-full 类', () => {
    const wrapper = mount(EmptyState, {
      props: { text: '空', full: true },
    });
    expect(wrapper.classes()).toContain('h-full');
  });
});
