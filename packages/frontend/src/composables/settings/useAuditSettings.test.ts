import { describe, it, expect, vi, beforeEach } from 'vitest';
import { defineComponent, nextTick } from 'vue';
import { mount } from '@vue/test-utils';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string, params?: Record<string, any>) => {
      if (!fallback) return _key;
      if (!params) return fallback;
      return fallback.replace('{count}', String(params.count ?? ''));
    },
  }),
}));

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

import apiClient from '../../utils/apiClient';
import { useAuditSettings } from './useAuditSettings';

const flush = async () => {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
};

describe('useAuditSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('onMounted 时应拉取最大保留条数与日志数量', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/settings/audit-log-max-entries') return Promise.resolve({ data: { maxEntries: 200 } });
      if (url === '/audit-logs/count') return Promise.resolve({ data: { count: 12 } });
      return Promise.resolve({ data: {} });
    });

    const Comp = defineComponent({
      setup() {
        return useAuditSettings();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    expect(apiClient.get).toHaveBeenCalledWith('/settings/audit-log-max-entries');
    expect(apiClient.get).toHaveBeenCalledWith('/audit-logs/count');
    expect((wrapper.vm as any).auditLogMaxEntries).toBe(200);
    expect((wrapper.vm as any).auditLogCount).toBe(12);
  });

  it('handleUpdateAuditLogMaxEntries 应调用后端专用端点', async () => {
    (apiClient.get as any).mockResolvedValueOnce({ data: { maxEntries: 50000 } });
    (apiClient.get as any).mockResolvedValueOnce({ data: { count: 0 } });
    (apiClient.put as any).mockResolvedValueOnce({ data: { maxEntries: 300 } });

    const Comp = defineComponent({
      setup() {
        return useAuditSettings();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    (wrapper.vm as any).auditLogMaxEntries = 300;
    await (wrapper.vm as any).handleUpdateAuditLogMaxEntries();

    expect(apiClient.put).toHaveBeenCalledWith('/settings/audit-log-max-entries', { maxEntries: 300 });
    expect((wrapper.vm as any).auditLogMaxEntriesSuccess).toBe(true);
    expect((wrapper.vm as any).auditLogMaxEntries).toBe(300);
  });

  it('handleDeleteAllAuditLogs 成功后应刷新日志数量', async () => {
    let countCalls = 0;
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/settings/audit-log-max-entries') return Promise.resolve({ data: { maxEntries: 50000 } });
      if (url === '/audit-logs/count') {
        countCalls += 1;
        return Promise.resolve({ data: { count: countCalls === 1 ? 7 : 0 } });
      }
      return Promise.resolve({ data: {} });
    });
    (apiClient.delete as any).mockResolvedValueOnce({ data: { deletedCount: 7 } });

    const Comp = defineComponent({
      setup() {
        return useAuditSettings();
      },
      template: '<div />',
    });

    const wrapper = mount(Comp);
    await flush();

    await (wrapper.vm as any).handleDeleteAllAuditLogs();

    expect(apiClient.delete).toHaveBeenCalledWith('/audit-logs');
    expect((wrapper.vm as any).deleteAuditLogsSuccess).toBe(true);
    expect(String((wrapper.vm as any).deleteAuditLogsMessage)).toContain('7');
  });
});
