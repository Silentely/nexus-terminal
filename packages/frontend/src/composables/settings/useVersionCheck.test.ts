/**
 * useVersionCheck 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockAxiosGet = vi.fn();
vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    isAxiosError: (error: unknown) => error && typeof error === 'object' && 'response' in error,
  },
}));

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// useVersionCheck 内部注册了 onMounted 生命周期钩子。单元测试直接调用 composable
// 时不存在活跃组件实例，会触发 "[Vue warn]: onMounted is called when there is no
// active component instance" 警告。这里将 onMounted 替换为 no-op，仅保留 ref/computed
// 等真实实现，使测试聚焦于 composable 返回值与 checkLatestVersion 行为本身。
vi.mock('vue', async () => {
  const actual = await vi.importActual<typeof import('vue')>('vue');
  return {
    ...actual,
    onMounted: () => {},
  };
});

describe('useVersionCheck', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it('应初始化为空状态', async () => {
    mockAxiosGet.mockRejectedValue(new Error('not found'));
    const { useVersionCheck } = await import('./useVersionCheck');
    const { appVersion, latestVersion, isCheckingVersion, versionCheckError } = useVersionCheck();

    expect(appVersion.value).toBe('');
    expect(latestVersion.value).toBeNull();
    expect(isCheckingVersion.value).toBe(false);
    expect(versionCheckError.value).toBeNull();
  });

  it('checkLatestVersion 应获取最新版本', async () => {
    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: 'v1.0.0' });
      if (url === '/api/v1/version/remote') return Promise.resolve({ data: { version: 'v3.0.0' } });
      return Promise.reject(new Error('unknown url'));
    });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, latestVersion } = useVersionCheck();

    await checkLatestVersion();

    expect(latestVersion.value).toBe('v3.0.0');
  });

  it('checkLatestVersion 失败应设置错误', async () => {
    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: 'v1.0.0' });
      if (url === '/api/v1/version/remote') return Promise.reject({ response: { status: 500 } });
      return Promise.reject(new Error('unknown url'));
    });
    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, versionCheckError } = useVersionCheck();

    await checkLatestVersion();

    expect(versionCheckError.value).toBeTruthy();
  });

  it('应返回所有预期的属性', async () => {
    mockAxiosGet.mockRejectedValue(new Error('fail'));
    const { useVersionCheck } = await import('./useVersionCheck');
    const result = useVersionCheck();

    expect(result).toHaveProperty('appVersion');
    expect(result).toHaveProperty('latestVersion');
    expect(result).toHaveProperty('isCheckingVersion');
    expect(result).toHaveProperty('versionCheckError');
    expect(result).toHaveProperty('isUpdateAvailable');
    expect(result).toHaveProperty('checkLatestVersion');
  });
});
