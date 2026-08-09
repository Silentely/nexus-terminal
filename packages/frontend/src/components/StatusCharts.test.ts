/**
 * StatusCharts 组件测试
 * 验证图表渲染与图表颜色为实际色值（非 var() 字符串，Chart.js 无法解析）
 */
import { ref } from 'vue';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { resetCssVarCache } from '../composables/useCssVar';

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

const mockStatusManager = {
  cpuHistory: { value: [10, 20, 30] },
  memUsedHistory: { value: [100, 200, 300] },
  netRxHistory: { value: [1000, 2000, 3000] },
  netTxHistory: { value: [500, 1000, 1500] },
};

const mockSessions = new Map([['session-1', { statusMonitorManager: mockStatusManager }]]);
const mockSessionsRef = ref(mockSessions);

vi.mock('../stores/session.store', () => ({
  useSessionStore: () => ({
    sessions: mockSessionsRef,
  }),
}));

vi.mock('pinia', async (importOriginal) => {
  const actual = await importOriginal<typeof import('pinia')>();
  return { ...actual, storeToRefs: (_store: unknown) => ({ sessions: mockSessionsRef }) };
});

import StatusCharts from './StatusCharts.vue';

describe('StatusCharts.vue', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    resetCssVarCache();
    const root = document.documentElement;
    root.style.setProperty('--text-color-secondary', '#909399');
  });

  it('应渲染 CPU 与网络图表', () => {
    const wrapper = mount(StatusCharts, {
      props: {
        serverStatus: { cpuPercent: 50 },
        activeSessionId: 'session-1',
      },
      global: {
        mocks: { $t: (key: string) => key },
      },
    });

    const lines = wrapper.findAllComponents({ name: 'Line' });
    expect(lines.length).toBeGreaterThanOrEqual(2);
  });

  it('图表刻度颜色应为实际色值而非 var() 字符串', () => {
    const wrapper = mount(StatusCharts, {
      props: {
        serverStatus: { cpuPercent: 50 },
        activeSessionId: 'session-1',
      },
      global: {
        mocks: { $t: (key: string) => key },
      },
    });

    const lines = wrapper.findAllComponents({ name: 'Line' });
    lines.forEach((line) => {
      const options = line.props('options') as {
        scales?: { x?: { ticks?: { color?: string } }; y?: { ticks?: { color?: string } } };
      };
      const tickColors = [options.scales?.x?.ticks?.color, options.scales?.y?.ticks?.color];
      tickColors.forEach((color) => {
        if (color) expect(color).not.toMatch(/^var\(/);
      });
    });
  });
});
