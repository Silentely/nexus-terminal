/**
 * SessionDurationChart 组件测试
 * 验证图表颜色从 CSS 变量读取实际值（而非 var() 字符串，Chart.js 无法解析）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { resetCssVarCache } from '../../composables/useCssVar';

// Mock vue-chartjs 的 Bar 组件，避免 canvas 渲染
vi.mock('vue-chartjs', () => ({
  Bar: {
    name: 'Bar',
    props: ['data', 'options'],
    template: '<div class="chart-bar" />',
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Mock appearance store，提供 currentUiTheme
vi.mock('../../stores/appearance.store', () => ({
  useAppearanceStore: () => ({
    currentUiTheme: { '--text-color': '#333333' },
  }),
}));

import SessionDurationChart from './SessionDurationChart.vue';

describe('SessionDurationChart.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetCssVarCache();
    // 预置 CSS 变量实际值，模拟主题已应用
    const root = document.documentElement;
    root.style.setProperty('--color-success', '#10b981');
    root.style.setProperty('--color-warning', '#f59e0b');
    root.style.setProperty('--color-error', '#ef4444');
    root.style.setProperty('--text-color-secondary', '#909399');
  });

  it('应正确渲染分布数据', () => {
    const wrapper = mount(SessionDurationChart, {
      props: {
        distribution: {
          lt5min: 1,
          '5min-30min': 2,
          '30min-1hr': 3,
          gt1hr: 4,
        },
      },
    });

    const bar = wrapper.findComponent({ name: 'Bar' });
    expect(bar.exists()).toBe(true);
    expect(bar.props('data').datasets[0].data).toEqual([1, 2, 3, 4]);
  });

  it('数据集颜色应为实际颜色值而非 var() 字符串', () => {
    const wrapper = mount(SessionDurationChart, {
      props: {
        distribution: { lt5min: 1 },
      },
    });

    const bar = wrapper.findComponent({ name: 'Bar' });
    const colors = bar.props('data').datasets[0].backgroundColor as string[];
    // 每个颜色都应是可被 Chart.js 解析的实际值（非 var(--...)）
    colors.forEach((color) => {
      expect(color).not.toMatch(/^var\(/);
      expect(color.length).toBeGreaterThan(0);
    });
  });
});
