import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick, ref } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
  createI18n: () => ({}),
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

vi.mock('../../i18n', () => ({
  availableLocales: ['en-US', 'zh-CN', 'ja-JP'],
}));

vi.mock('pinia', async () => {
  const actual = await vi.importActual<any>('pinia');
  return {
    ...actual,
    storeToRefs: (store: any) => store,
  };
});

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

const settingsStoreMock = {
  settings: ref({
    language: 'en-US',
    timezone: 'UTC',
    statusMonitorIntervalSeconds: '3',
    dockerStatusIntervalSeconds: '2',
    dockerDefaultExpand: 'false',
  }),
  language: ref('en-US'),
  statusMonitorIntervalSecondsNumber: ref(3),
  dockerDefaultExpandBoolean: ref(false),
  updateSetting: vi.fn().mockResolvedValue(undefined),
  updateMultipleSettings: vi.fn().mockResolvedValue(undefined),
};

vi.mock('../../stores/settings.store', () => ({
  useSettingsStore: () => settingsStoreMock,
}));

import apiClient from '../../utils/apiClient';
import { useSystemSettings } from './useSystemSettings';

const flush = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
};

describe('useSystemSettings (log level)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onMounted 时应拉取日志等级并写入 selectedLogLevel', async () => {
    (apiClient.get as any).mockResolvedValueOnce({ data: { level: 'warn' } });

    const Comp = defineComponent({
      setup() {
        return useSystemSettings();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    expect(apiClient.get).toHaveBeenCalledWith('/settings/log-level');
    expect((wrapper.vm as any).selectedLogLevel).toBe('warn');
  });

  it('handleUpdateLogLevel 应调用 PUT /settings/log-level', async () => {
    (apiClient.get as any).mockResolvedValueOnce({ data: { level: 'info' } });
    (apiClient.put as any).mockResolvedValueOnce({ data: { level: 'error' } });

    const Comp = defineComponent({
      setup() {
        return useSystemSettings();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    (wrapper.vm as any).selectedLogLevel = 'error';
    await (wrapper.vm as any).handleUpdateLogLevel();

    expect(apiClient.put).toHaveBeenCalledWith('/settings/log-level', { level: 'error' });
    expect((wrapper.vm as any).logLevelSuccess).toBe(true);
  });
});
