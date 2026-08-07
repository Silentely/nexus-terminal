/**
 * useFileManagerDownload 单元测试
 * 覆盖文件/目录下载触发的守卫逻辑与网络错误用户友好提示
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computed, ref } from 'vue';
import { useFileManagerDownload } from './useFileManagerDownload';

// Mock 会话依赖获取
vi.mock('./fileManagerWsUtils', () => ({
  getWsDepsFromSession: () => ({ isConnected: { value: true } }),
}));

// Mock log
vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('useFileManagerDownload', () => {
  const showError = vi.fn();
  const t = vi.fn((key: string, fallback?: string) => fallback ?? key);

  const mockManager = () => ({
    currentPath: ref('/home'),
    joinPath: (base: string, name: string) => `${base}/${name}`,
  });

  const createOptions = (overrides: Record<string, unknown> = {}) => ({
    currentSftpManager: computed(() => mockManager() as never),
    dbConnectionId: '1',
    sessionId: computed(() => 'sess-1'),
    instanceId: 'inst-1',
    sessionStore: {} as never,
    showError,
    t,
    recoverManager: undefined,
    ...overrides,
  });

  beforeEach(() => {
    showError.mockClear();
    t.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('triggerDownload', () => {
    it('SFTP 管理器不可用且无法恢复时应提示错误', () => {
      const { triggerDownload } = useFileManagerDownload(
        createOptions({ currentSftpManager: computed(() => null) }),
      );
      triggerDownload([
        { filename: 'a.txt', attrs: { isFile: true, isDirectory: false } } as never,
      ]);
      expect(showError).toHaveBeenCalledWith('SFTP manager is not available.');
    });

    it('跳过非文件条目', () => {
      const { triggerDownload } = useFileManagerDownload(createOptions());
      triggerDownload([{ filename: 'dir', attrs: { isFile: false, isDirectory: true } } as never]);
      expect(showError).not.toHaveBeenCalled();
    });

    it('缺失 dbConnectionId 时不触发下载', () => {
      const { triggerDownload } = useFileManagerDownload(createOptions({ dbConnectionId: '' }));
      triggerDownload([{ filename: 'a.txt', attrs: { isFile: true } } as never]);
      expect(showError).not.toHaveBeenCalled();
    });
  });

  describe('triggerDownloadDirectory 网络错误', () => {
    it('网络失败时应显示本地化友好提示（t 注入时）', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      const { triggerDownloadDirectory } = useFileManagerDownload(createOptions());

      triggerDownloadDirectory({
        filename: 'folder',
        attrs: { isDirectory: true, isFile: false },
      } as never);

      // fetch promise 链需要微任务推进
      await Promise.resolve();
      await Promise.resolve();

      expect(showError).toHaveBeenCalledWith('网络连接失败，请检查连接后重试。');
      expect(t).toHaveBeenCalledWith(
        'fileManager.errors.downloadNetworkError',
        '网络连接失败，请检查连接后重试。',
      );
    });

    it('网络失败且未注入 t 时使用英文回退', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
      const { triggerDownloadDirectory } = useFileManagerDownload(createOptions({ t: undefined }));

      triggerDownloadDirectory({
        filename: 'folder',
        attrs: { isDirectory: true, isFile: false },
      } as never);

      await Promise.resolve();
      await Promise.resolve();

      expect(showError).toHaveBeenCalledWith(
        'Network connection failed. Please check your connection and try again.',
      );
    });

    it('服务器返回错误状态时应展示服务端消息', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => ({ message: '服务器压缩失败' }),
        }),
      );
      const { triggerDownloadDirectory } = useFileManagerDownload(createOptions());

      triggerDownloadDirectory({
        filename: 'folder',
        attrs: { isDirectory: true, isFile: false },
      } as never);

      await Promise.resolve();
      await Promise.resolve();

      expect(showError).toHaveBeenCalledWith('服务器压缩失败');
    });
  });
});
