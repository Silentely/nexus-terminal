/**
 * ErrorBanner.vue 单元测试
 * 验证统一错误横幅组件的渲染、文案、图标与紧凑模式
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import ErrorBanner from './ErrorBanner.vue';

describe('ErrorBanner.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('渲染错误文案并带 role="alert"', () => {
    const wrapper = mount(ErrorBanner, {
      props: { message: '连接失败' },
    });
    expect(wrapper.text()).toContain('连接失败');
    expect(wrapper.attributes('role')).toBe('alert');
  });

  it('默认显示警示图标', () => {
    const wrapper = mount(ErrorBanner, {
      props: { message: '出错' },
    });
    expect(wrapper.find('i.fa-exclamation-circle').exists()).toBe(true);
  });

  it('showIcon=false 时隐藏图标', () => {
    const wrapper = mount(ErrorBanner, {
      props: { message: '出错', showIcon: false },
    });
    expect(wrapper.find('i').exists()).toBe(false);
  });

  it('compact 模式添加紧凑样式类', () => {
    const wrapper = mount(ErrorBanner, {
      props: { message: '出错', compact: true },
    });
    expect(wrapper.classes()).toContain('p-2');
    expect(wrapper.classes()).toContain('text-xs');
  });
});
