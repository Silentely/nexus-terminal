/**
 * useVersionCheck 单元测试
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

const mockAxiosGet = vi.fn();
const mockIsAxiosError = vi.fn((error: unknown) =>
  Boolean(error && typeof error === 'object' && 'response' in (error as object)),
);

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args),
    isAxiosError: (error: unknown) => mockIsAxiosError(error),
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

describe('useVersionCheck', () => {
  beforeEach(async () => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('./useVersionCheck');
    mod.__resetVersionCheckStateForTests();
  });

  it('应初始化为空状态', async () => {
    mockAxiosGet.mockRejectedValue(new Error('not found'));
    const { useVersionCheck } = await import('./useVersionCheck');
    const { appVersion, latestVersion, isCheckingVersion, versionCheckError, isUpdateAvailable } =
      useVersionCheck();

    expect(appVersion.value).toBe('');
    expect(latestVersion.value).toBeNull();
    expect(isCheckingVersion.value).toBe(false);
    expect(versionCheckError.value).toBeNull();
    expect(isUpdateAvailable.value).toBe(false);
  });

  it('checkLatestVersion 应获取最新版本并做 semver 比较', async () => {
    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: '1.0.0' });
      if (url === '/api/v1/version/check') {
        return Promise.resolve({
          data: {
            version: '1.10.0',
            rawVersion: '1.10.0',
            htmlUrl: 'https://github.com/Silentely/nexus-terminal/releases/tag/v1.10.0',
            source: 'version_file',
          },
        });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, latestVersion, isUpdateAvailable, releaseUrl, appVersion } =
      useVersionCheck();

    await checkLatestVersion();

    expect(appVersion.value).toBe('1.0.0');
    expect(latestVersion.value).toBe('1.10.0');
    expect(isUpdateAvailable.value).toBe(true);
    expect(releaseUrl.value).toContain('releases/tag/v1.10.0');
  });

  it('远程版本不高于本地时不应提示更新', async () => {
    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: '2.0.0' });
      if (url === '/api/v1/version/check') {
        return Promise.resolve({ data: { version: '1.9.0', rawVersion: '1.9.0' } });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, isUpdateAvailable } = useVersionCheck();
    await checkLatestVersion();

    expect(isUpdateAvailable.value).toBe(false);
  });

  it('本地为 dev 时不应误报更新', async () => {
    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: 'dev' });
      if (url === '/api/v1/version/check') {
        return Promise.resolve({ data: { version: '1.5.7', rawVersion: '1.5.7' } });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, isUpdateAvailable, latestVersion } = useVersionCheck();
    await checkLatestVersion();

    expect(latestVersion.value).toBe('1.5.7');
    expect(isUpdateAvailable.value).toBe(false);
  });

  it('checkLatestVersion 失败应设置错误', async () => {
    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: '1.0.0' });
      if (url === '/api/v1/version/check') {
        return Promise.reject({ response: { status: 500 } });
      }
      return Promise.reject(new Error(`unknown url: ${url}`));
    });
    mockIsAxiosError.mockReturnValue(true);

    const { useVersionCheck } = await import('./useVersionCheck');
    const { checkLatestVersion, versionCheckError } = useVersionCheck();
    await checkLatestVersion();

    expect(versionCheckError.value).toBeTruthy();
  });

  it('多次调用应共享状态并去重请求', async () => {
    let resolveCheck: (value: unknown) => void = () => {};
    const checkDeferred = new Promise((resolve) => {
      resolveCheck = resolve;
    });

    mockAxiosGet.mockImplementation((url: string) => {
      if (url === '/VERSION') return Promise.resolve({ data: '1.0.0' });
      if (url === '/api/v1/version/check') return checkDeferred;
      return Promise.reject(new Error(`unknown url: ${url}`));
    });

    const { useVersionCheck } = await import('./useVersionCheck');
    const a = useVersionCheck();
    const b = useVersionCheck();

    const p1 = a.checkLatestVersion();
    const p2 = b.checkLatestVersion();

    // 等待 loadAppVersion 完成并进入 check 请求
    await vi.waitFor(() => {
      const checkCalls = mockAxiosGet.mock.calls.filter(
        (c: unknown[]) => c[0] === '/api/v1/version/check',
      );
      expect(checkCalls.length).toBe(1);
    });

    resolveCheck({
      data: { version: '1.1.0', rawVersion: '1.1.0', htmlUrl: null, source: 'version_file' },
    });
    await Promise.all([p1, p2]);

    expect(a.latestVersion.value).toBe('1.1.0');
    expect(b.latestVersion.value).toBe('1.1.0');
    expect(a.isUpdateAvailable.value).toBe(true);
    expect(b.isUpdateAvailable.value).toBe(true);

    // 成功后再次调用不重复请求
    mockAxiosGet.mockClear();
    await a.checkLatestVersion();
    expect(mockAxiosGet).not.toHaveBeenCalled();
  });

  it('应返回所有预期的属性', async () => {
    mockAxiosGet.mockRejectedValue(new Error('fail'));
    const { useVersionCheck } = await import('./useVersionCheck');
    const result = useVersionCheck();

    expect(result).toHaveProperty('appVersion');
    expect(result).toHaveProperty('latestVersion');
    expect(result).toHaveProperty('releaseUrl');
    expect(result).toHaveProperty('isCheckingVersion');
    expect(result).toHaveProperty('versionCheckError');
    expect(result).toHaveProperty('isUpdateAvailable');
    expect(result).toHaveProperty('checkLatestVersion');
  });
});
