/**
 * useExportConnections 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockApiGet = vi.fn();
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (_key: string, fallback?: string) => fallback || _key,
  }),
}));

vi.mock('axios', () => ({
  isAxiosError: (err: unknown) => err && typeof err === 'object' && 'response' in err,
  default: {
    isAxiosError: (err: unknown) => err && typeof err === 'object' && 'response' in err,
  },
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('useExportConnections', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    // Mock DOM APIs
    vi.spyOn(document, 'createElement').mockReturnValue({
      href: '',
      setAttribute: vi.fn(),
      click: vi.fn(),
    } as unknown as HTMLElement);
    vi.spyOn(document.body, 'appendChild').mockImplementation(() => null as any);
    vi.spyOn(document.body, 'removeChild').mockImplementation(() => null as any);
    vi.spyOn(window.URL, 'createObjectURL').mockReturnValue('blob:url');
    vi.spyOn(window.URL, 'revokeObjectURL').mockImplementation(() => {});
  });

  it('应初始化为空状态', async () => {
    const { useExportConnections } = await import('./useExportConnections');
    const { exportConnectionsLoading, exportConnectionsSuccess, exportConnectionsMessage } =
      useExportConnections();

    expect(exportConnectionsLoading.value).toBe(false);
    expect(exportConnectionsSuccess.value).toBe(false);
    expect(exportConnectionsMessage.value).toBe('');
  });

  it('导出成功应设置成功状态', async () => {
    mockApiGet.mockResolvedValue({
      data: new Blob(['test']),
      headers: { 'content-type': 'application/zip' },
    });

    const { useExportConnections } = await import('./useExportConnections');
    const { handleExportConnections, exportConnectionsSuccess, exportConnectionsLoading } =
      useExportConnections();

    await handleExportConnections();

    expect(exportConnectionsSuccess.value).toBe(true);
    expect(exportConnectionsLoading.value).toBe(false);
  });

  it('导出失败应设置错误状态', async () => {
    mockApiGet.mockRejectedValue(new Error('Export failed'));

    const { useExportConnections } = await import('./useExportConnections');
    const { handleExportConnections, exportConnectionsSuccess, exportConnectionsMessage } =
      useExportConnections();

    await handleExportConnections();

    expect(exportConnectionsSuccess.value).toBe(false);
    expect(exportConnectionsMessage.value).toBeTruthy();
  });

  it('应支持密码保护导出', async () => {
    mockApiGet.mockResolvedValue({
      data: new Blob(['test']),
      headers: { 'content-type': 'application/zip' },
    });

    const { useExportConnections } = await import('./useExportConnections');
    const { handleExportConnections } = useExportConnections();

    await handleExportConnections('mypassword');

    expect(mockApiGet).toHaveBeenCalledWith(
      '/settings/export-connections',
      expect.objectContaining({
        headers: { 'x-export-password': 'mypassword' },
      }),
    );
  });

  it('应返回所有预期的属性', async () => {
    const { useExportConnections } = await import('./useExportConnections');
    const result = useExportConnections();

    expect(result).toHaveProperty('exportConnectionsLoading');
    expect(result).toHaveProperty('exportConnectionsMessage');
    expect(result).toHaveProperty('exportConnectionsSuccess');
    expect(result).toHaveProperty('handleExportConnections');
  });
});
