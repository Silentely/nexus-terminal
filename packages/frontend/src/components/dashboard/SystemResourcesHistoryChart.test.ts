/**
 * SystemResourcesHistoryChart 组件测试
 * 验证图表颜色从 CSS 变量读取实际值（而非 var()/color-mix()，Chart.js 无法解析）
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { resetCssVarCache } from '../../composables/useCssVar';

// Mock vue-chartjs 的 Line 组件，避免 canvas 渲染
vi.mock('vue-chartjs', () => ({
  Line: {
    name: 'Line',
    props: ['data', 'options'],
    template: '<div class="chart-line" />',
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('../../stores/appearance.store', () => ({
  useAppearanceStore: () => ({
    currentUiTheme: { '--text-color': '#333333' },
  }),
}));

import SystemResourcesHistoryChart from './SystemResourcesHistoryChart.vue';

describe('SystemResourcesHistoryChart.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetCssVarCache();
    const root = document.documentElement;
    root.style.setProperty('--color-primary', '#0ea5e9');
    root.style.setProperty('--color-success', '#10b981');
    root.style.setProperty('--color-warning', '#f59e0b');
  });

  const mockHistory = [
    { timestamp: 1704103200000, cpuPercent: 10, memPercent: 20, diskPercent: 30 },
    { timestamp: 1704103205000, cpuPercent: 15, memPercent: 25, diskPercent: 35 },
  ];

  it('应正确渲染历史数据', () => {
    const wrapper = mount(SystemResourcesHistoryChart, {
      props: { history: mockHistory },
    });

    const line = wrapper.findComponent({ name: 'Line' });
    expect(line.exists()).toBe(true);
    const datasets = line.props('data').datasets;
    expect(datasets).toHaveLength(3);
    expect(datasets[0].data).toEqual([10, 15]);
    expect(datasets[1].data).toEqual([20, 25]);
    expect(datasets[2].data).toEqual([30, 35]);
  });

  it('数据集颜色应为实际颜色值而非 var()/color-mix() 字符串', () => {
    const wrapper = mount(SystemResourcesHistoryChart, {
      props: { history: mockHistory },
    });

    const line = wrapper.findComponent({ name: 'Line' });
    const datasets = line.props('data').datasets;
    datasets.forEach((dataset: { borderColor: string; backgroundColor: string }) => {
      expect(dataset.borderColor).not.toMatch(/^var\(/);
      expect(dataset.borderColor).not.toMatch(/^color-mix\(/);
      expect(dataset.backgroundColor).not.toMatch(/^var\(/);
      expect(dataset.backgroundColor).not.toMatch(/^color-mix\(/);
    });
    // 填充色应为 rgba（基于主色生成）
    expect(datasets[0].backgroundColor).toMatch(/^rgba\(/);
  });
});
