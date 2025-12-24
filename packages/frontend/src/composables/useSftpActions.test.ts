/**
 * useSftpActions Composable 单元测试
 * 测试 SFTP 文件操作管理的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref, computed, nextTick, type Ref } from 'vue';
import { createSftpActionsManager, type WebSocketDependencies } from './useSftpActions';

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, any>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

// Mock uiNotifications store
const mockShowError = vi.fn();
const mockShowSuccess = vi.fn();
const mockShowWarning = vi.fn();

vi.mock('../stores/uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    showError: mockShowError,
    showSuccess: mockShowSuccess,
    showWarning: mockShowWarning,
  }),
}));

describe('useSftpActions (createSftpActionsManager)', () => {
  let mockSendMessage: ReturnType<typeof vi.fn>;
  let mockOnMessage: ReturnType<typeof vi.fn>;
  let mockIsConnected: Ref<boolean>;
  let mockIsSftpReady: Ref<boolean>;
  let currentPathRef: Ref<string>;
  let messageHandlers: Map<string, ((payload: any, message?: any) => void)[]>;

  // 模拟 i18n 翻译函数
  const mockT = (key: string, params?: Record<string, any>) => {
    if (params) return `${key}:${JSON.stringify(params)}`;
    return key;
  };

  // 辅助函数：创建 WebSocket 依赖
  function createWsDeps(): WebSocketDependencies {
    return {
      sendMessage: mockSendMessage,
      onMessage: mockOnMessage,
      isConnected: computed(() => mockIsConnected.value),
      isSftpReady: mockIsSftpReady,
    };
  }

  // 辅助函数：触发消息处理器
  function triggerMessage(type: string, payload: any, extras?: Record<string, any>) {
    const handlers = messageHandlers.get(type) || [];
    handlers.forEach((handler) => handler(payload, { type, ...extras }));
  }

  // 辅助函数：创建测试文件项
  function createFileItem(filename: string, isDirectory: boolean = false) {
    return {
      filename,
      longname: `drwxr-xr-x 2 user user 4096 Jan 01 00:00 ${filename}`,
      attrs: {
        isDirectory,
        isFile: !isDirectory,
        isSymbolicLink: false,
        size: isDirectory ? 4096 : 1024,
        mtime: Date.now() / 1000,
        atime: Date.now() / 1000,
        uid: 1000,
        gid: 1000,
        mode: isDirectory ? 0o755 : 0o644,
      },
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();

    mockSendMessage = vi.fn();
    mockIsConnected = ref(true);
    mockIsSftpReady = ref(true);
    currentPathRef = ref('/home/user');
    messageHandlers = new Map();

    // 模拟 onMessage 注册消息处理器
    mockOnMessage = vi.fn((type: string, handler: (payload: any, message?: any) => void) => {
      if (!messageHandlers.has(type)) {
        messageHandlers.set(type, []);
      }
      messageHandlers.get(type)!.push(handler);
      return () => {
        const handlers = messageHandlers.get(type);
        if (handlers) {
          const index = handlers.indexOf(handler);
          if (index > -1) handlers.splice(index, 1);
        }
      };
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe('初始化', () => {
    it('应创建管理器并注册消息处理器', () => {
      createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 应注册所有 SFTP 相关消息处理器
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:readdir:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:readdir:error', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:mkdir:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:mkdir:error', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:rmdir:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:unlink:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:rename:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:chmod:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:writefile:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:copy:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:move:success', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('sftp:upload:success', expect.any(Function));
    });

    it('应暴露所需的方法和状态', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 状态
      expect(manager.fileList).toBeDefined();
      expect(manager.isLoading).toBeDefined();
      expect(manager.fileTree).toBeDefined();
      expect(manager.initialLoadDone).toBeDefined();
      expect(manager.currentPath).toBeDefined();

      // 方法
      expect(typeof manager.loadDirectory).toBe('function');
      expect(typeof manager.createDirectory).toBe('function');
      expect(typeof manager.createFile).toBe('function');
      expect(typeof manager.deleteItems).toBe('function');
      expect(typeof manager.renameItem).toBe('function');
      expect(typeof manager.changePermissions).toBe('function');
      expect(typeof manager.readFile).toBe('function');
      expect(typeof manager.writeFile).toBe('function');
      expect(typeof manager.copyItems).toBe('function');
      expect(typeof manager.moveItems).toBe('function');
      expect(typeof manager.compressItems).toBe('function');
      expect(typeof manager.decompressItem).toBe('function');
      expect(typeof manager.joinPath).toBe('function');
      expect(typeof manager.cleanup).toBe('function');
    });

    it('初始状态应为空', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      expect(manager.fileList.value).toEqual([]);
      expect(manager.isLoading.value).toBe(false);
      expect(manager.initialLoadDone.value).toBe(false);
    });
  });

  describe('loadDirectory', () => {
    it('应发送 sftp:readdir 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:readdir',
          payload: { path: '/home/user' },
        })
      );
      expect(manager.isLoading.value).toBe(true);
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('已在加载中时不应发送新请求', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');
      expect(mockSendMessage).toHaveBeenCalledTimes(1);

      // 尝试再次加载
      manager.loadDirectory('/home/user/subdir');

      // 应该仍然只有一次调用
      expect(mockSendMessage).toHaveBeenCalledTimes(1);
    });

    it('缓存命中时不应发送请求', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 第一次加载
      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;

      // 模拟成功响应
      triggerMessage(
        'sftp:readdir:success',
        [createFileItem('file1.txt'), createFileItem('dir1', true)],
        { path: '/home/user', requestId }
      );

      mockSendMessage.mockClear();

      // 再次加载同一目录（应使用缓存）
      manager.loadDirectory('/home/user');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('强制刷新应忽略缓存', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 第一次加载
      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;

      // 模拟成功响应
      triggerMessage('sftp:readdir:success', [createFileItem('file1.txt')], {
        path: '/home/user',
        requestId,
      });

      mockSendMessage.mockClear();

      // 强制刷新
      manager.loadDirectory('/home/user', true);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:readdir',
          payload: { path: '/home/user' },
        })
      );
    });
  });

  describe('sftp:readdir:success 消息处理', () => {
    it('应更新文件列表和当前路径', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;

      const files = [
        createFileItem('file1.txt'),
        createFileItem('file2.txt'),
        createFileItem('dir1', true),
      ];

      triggerMessage('sftp:readdir:success', files, { path: '/home/user', requestId });

      expect(manager.isLoading.value).toBe(false);
      expect(manager.currentPath.value).toBe('/home/user');
      expect(manager.fileList.value.length).toBe(3);
    });

    it('应按目录优先、名称排序', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;

      const files = [
        createFileItem('zebra.txt'),
        createFileItem('alpha', true),
        createFileItem('beta', true),
        createFileItem('apple.txt'),
      ];

      triggerMessage('sftp:readdir:success', files, { path: '/home/user', requestId });

      const fileNames = manager.fileList.value.map((f) => f.filename);
      // 目录优先，然后按名称排序
      expect(fileNames[0]).toBe('alpha');
      expect(fileNames[1]).toBe('beta');
      expect(fileNames[2]).toBe('apple.txt');
      expect(fileNames[3]).toBe('zebra.txt');
    });

    it('应忽略过时的响应', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');
      const oldRequestId = (mockSendMessage.mock.calls[0][0] as any).requestId;

      // 模拟一个过时的响应（不同的 requestId）
      triggerMessage('sftp:readdir:success', [createFileItem('stale.txt')], {
        path: '/home/user',
        requestId: 'old-request-id',
      });

      // 应该仍然是加载中状态
      expect(manager.isLoading.value).toBe(true);
      expect(manager.fileList.value.length).toBe(0);
    });
  });

  describe('sftp:readdir:error 消息处理', () => {
    it('应显示错误并重置加载状态', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;

      triggerMessage('sftp:readdir:error', 'Permission denied', { path: '/home/user', requestId });

      expect(manager.isLoading.value).toBe(false);
      expect(mockShowError).toHaveBeenCalled();
    });
  });

  describe('createDirectory', () => {
    it('应发送 sftp:mkdir 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.createDirectory('new_folder');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:mkdir',
          payload: { path: '/home/user/new_folder' },
        })
      );
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.createDirectory('new_folder');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });
  });

  describe('createFile', () => {
    it('应发送 sftp:writefile 消息创建空文件', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.createFile('new_file.txt');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:writefile',
          payload: { path: '/home/user/new_file.txt', content: '', encoding: 'utf8' },
        })
      );
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.createFile('new_file.txt');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });
  });

  describe('deleteItems', () => {
    it('应为文件发送 sftp:unlink 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.deleteItems([createFileItem('file.txt')]);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:unlink',
          payload: { path: '/home/user/file.txt' },
        })
      );
    });

    it('应为目录发送 sftp:rmdir 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.deleteItems([createFileItem('folder', true)]);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:rmdir',
          payload: { path: '/home/user/folder' },
        })
      );
    });

    it('应批量删除多个项目', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.deleteItems([
        createFileItem('file1.txt'),
        createFileItem('file2.txt'),
        createFileItem('folder', true),
      ]);

      expect(mockSendMessage).toHaveBeenCalledTimes(3);
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.deleteItems([createFileItem('file.txt')]);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('空项目列表不应发送消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.deleteItems([]);

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('renameItem', () => {
    it('应发送 sftp:rename 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.renameItem(createFileItem('old_name.txt'), 'new_name.txt');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:rename',
          payload: {
            oldPath: '/home/user/old_name.txt',
            newPath: '/home/user/new_name.txt',
          },
        })
      );
    });

    it('应支持绝对路径作为新名称（用于移动）', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.renameItem(createFileItem('file.txt'), '/other/path/file.txt');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:rename',
          payload: {
            oldPath: '/home/user/file.txt',
            newPath: '/other/path/file.txt',
          },
        })
      );
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.renameItem(createFileItem('old.txt'), 'new.txt');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('新名称与旧名称相同时不应发送消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.renameItem(createFileItem('same.txt'), 'same.txt');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });

    it('新名称为空时不应发送消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.renameItem(createFileItem('file.txt'), '');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('changePermissions', () => {
    it('应发送 sftp:chmod 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.changePermissions(createFileItem('file.txt'), 0o755);

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:chmod',
          payload: {
            path: '/home/user/file.txt',
            mode: 0o755,
          },
        })
      );
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.changePermissions(createFileItem('file.txt'), 0o755);

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });
  });

  describe('readFile', () => {
    it('应发送 sftp:readfile 消息并返回 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const readPromise = manager.readFile('/home/user/test.txt');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:readfile',
          payload: { path: '/home/user/test.txt' },
        })
      );

      // 模拟成功响应
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage(
        'sftp:readfile:success',
        { rawContentBase64: btoa('Hello World'), encodingUsed: 'utf8' },
        { requestId, path: '/home/user/test.txt' }
      );

      const result = await readPromise;
      expect(result.rawContentBase64).toBe(btoa('Hello World'));
      expect(result.encodingUsed).toBe('utf8');
    });

    it('应支持指定编码', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.readFile('/home/user/test.txt', 'gbk');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:readfile',
          payload: { path: '/home/user/test.txt', encoding: 'gbk' },
        })
      );
    });

    it('SFTP 未就绪时应拒绝 Promise', async () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      await expect(manager.readFile('/home/user/test.txt')).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('超时应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const readPromise = manager.readFile('/home/user/test.txt');

      // 快进 20 秒（超时时间）
      vi.advanceTimersByTime(20000);

      await expect(readPromise).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('错误响应应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const readPromise = manager.readFile('/home/user/test.txt');

      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:readfile:error', 'File not found', {
        requestId,
        path: '/home/user/test.txt',
      });

      await expect(readPromise).rejects.toThrow('File not found');
    });
  });

  describe('writeFile', () => {
    it('应发送 sftp:writefile 消息并返回 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const writePromise = manager.writeFile('/home/user/test.txt', 'Hello World');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:writefile',
          payload: { path: '/home/user/test.txt', content: 'Hello World', encoding: 'utf8' },
        })
      );

      // 模拟成功响应
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:writefile:success', null, {
        requestId,
        path: '/home/user/test.txt',
      });

      await writePromise; // 应该 resolve
    });

    it('应支持指定编码', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.writeFile('/home/user/test.txt', 'content', 'gbk');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:writefile',
          payload: { path: '/home/user/test.txt', content: 'content', encoding: 'gbk' },
        })
      );
    });

    it('SFTP 未就绪时应拒绝 Promise', async () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      await expect(manager.writeFile('/home/user/test.txt', 'content')).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('超时应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const writePromise = manager.writeFile('/home/user/test.txt', 'content');

      vi.advanceTimersByTime(20000);

      await expect(writePromise).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('错误响应应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const writePromise = manager.writeFile('/home/user/test.txt', 'content');

      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:writefile:error', 'Disk full', {
        requestId,
        path: '/home/user/test.txt',
      });

      await expect(writePromise).rejects.toThrow('Disk full');
    });
  });

  describe('copyItems', () => {
    it('应发送 sftp:copy 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.copyItems(['/home/user/file1.txt', '/home/user/file2.txt'], '/home/user/backup');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:copy',
          payload: {
            sources: ['/home/user/file1.txt', '/home/user/file2.txt'],
            destination: '/home/user/backup',
          },
        })
      );
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.copyItems(['/home/user/file.txt'], '/home/user/backup');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('空源路径列表不应发送消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.copyItems([], '/home/user/backup');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('moveItems', () => {
    it('应发送 sftp:move 消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.moveItems(['/home/user/file1.txt', '/home/user/file2.txt'], '/home/user/archive');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:move',
          payload: {
            sources: ['/home/user/file1.txt', '/home/user/file2.txt'],
            destination: '/home/user/archive',
          },
        })
      );
    });

    it('SFTP 未就绪时不应发送消息', () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.moveItems(['/home/user/file.txt'], '/home/user/archive');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('空源路径列表不应发送消息', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      manager.moveItems([], '/home/user/archive');

      expect(mockSendMessage).not.toHaveBeenCalled();
    });
  });

  describe('compressItems', () => {
    it('应发送 sftp:compress 消息并返回 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const compressPromise = manager.compressItems([createFileItem('file.txt')], 'zip');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:compress',
          payload: expect.objectContaining({
            sources: ['/home/user/file.txt'],
            format: 'zip',
          }),
        })
      );

      // 模拟成功响应
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:compress:success', {}, { requestId });

      await compressPromise;
      expect(mockShowSuccess).toHaveBeenCalled();
    });

    it('SFTP 未就绪时应拒绝 Promise', async () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      await expect(manager.compressItems([createFileItem('file.txt')], 'zip')).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('超时应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const compressPromise = manager.compressItems([createFileItem('file.txt')], 'zip');

      vi.advanceTimersByTime(60000);

      await expect(compressPromise).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('错误响应应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const compressPromise = manager.compressItems([createFileItem('file.txt')], 'zip');

      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage(
        'sftp:compress:error',
        { error: 'Compression failed', details: 'Out of space' },
        { requestId }
      );

      await expect(compressPromise).rejects.toThrow('Out of space');
    });
  });

  describe('decompressItem', () => {
    it('应发送 sftp:decompress 消息并返回 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const decompressPromise = manager.decompressItem(createFileItem('archive.zip'));

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'sftp:decompress',
          payload: {
            source: '/home/user/archive.zip',
            destination: '/home/user',
          },
        })
      );

      // 模拟成功响应
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:decompress:success', {}, { requestId });

      await decompressPromise;
      expect(mockShowSuccess).toHaveBeenCalled();
    });

    it('SFTP 未就绪时应拒绝 Promise', async () => {
      mockIsSftpReady.value = false;
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      await expect(manager.decompressItem(createFileItem('archive.zip'))).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('超时应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const decompressPromise = manager.decompressItem(createFileItem('archive.zip'));

      vi.advanceTimersByTime(60000);

      await expect(decompressPromise).rejects.toThrow();
      expect(mockShowError).toHaveBeenCalled();
    });

    it('错误响应应拒绝 Promise', async () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      const decompressPromise = manager.decompressItem(createFileItem('archive.zip'));

      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage(
        'sftp:decompress:error',
        { error: 'Decompression failed', details: 'Corrupted archive' },
        { requestId }
      );

      await expect(decompressPromise).rejects.toThrow('Corrupted archive');
    });
  });

  describe('joinPath', () => {
    it('应正确拼接路径', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      expect(manager.joinPath('/home', 'user')).toBe('/home/user');
      expect(manager.joinPath('/home/', 'user')).toBe('/home/user');
      expect(manager.joinPath('/', 'home')).toBe('/home');
    });
  });

  describe('cleanup', () => {
    it('应注销所有消息处理器', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 确认处理器已注册
      expect(messageHandlers.get('sftp:readdir:success')?.length).toBeGreaterThan(0);

      manager.cleanup();

      // 处理器应被移除
      expect(messageHandlers.get('sftp:readdir:success')?.length).toBe(0);
    });
  });

  describe('操作成功消息处理', () => {
    it('sftp:mkdir:success 应更新文件树', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 先加载目录以建立文件树
      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:readdir:success', [createFileItem('existing.txt')], {
        path: '/home/user',
        requestId,
      });

      // 触发创建目录成功
      const newFolder = createFileItem('new_folder', true);
      triggerMessage('sftp:mkdir:success', newFolder, { path: '/home/user/new_folder' });

      // 文件树应该包含新目录
      expect(manager.fileList.value.some((f) => f.filename === 'new_folder')).toBe(true);
    });

    it('sftp:rmdir:success 应从文件树移除项目', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 先加载目录
      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage(
        'sftp:readdir:success',
        [createFileItem('folder', true), createFileItem('file.txt')],
        { path: '/home/user', requestId }
      );

      expect(manager.fileList.value.length).toBe(2);

      // 触发删除成功
      triggerMessage('sftp:rmdir:success', null, { path: '/home/user/folder' });

      expect(manager.fileList.value.length).toBe(1);
      expect(manager.fileList.value.some((f) => f.filename === 'folder')).toBe(false);
    });

    it('sftp:rename:success 应更新文件树', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      // 先加载目录
      manager.loadDirectory('/home/user');
      const requestId = (mockSendMessage.mock.calls[0][0] as any).requestId;
      triggerMessage('sftp:readdir:success', [createFileItem('old_name.txt')], {
        path: '/home/user',
        requestId,
      });

      // 触发重命名成功
      const renamedItem = createFileItem('new_name.txt');
      triggerMessage(
        'sftp:rename:success',
        {
          oldPath: '/home/user/old_name.txt',
          newPath: '/home/user/new_name.txt',
          newItem: renamedItem,
        },
        {}
      );

      expect(manager.fileList.value.some((f) => f.filename === 'old_name.txt')).toBe(false);
      expect(manager.fileList.value.some((f) => f.filename === 'new_name.txt')).toBe(true);
    });

    it('sftp:copy:success 应显示成功通知', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      triggerMessage('sftp:copy:success', { destination: '/home/user/backup', items: null }, {});

      expect(mockShowSuccess).toHaveBeenCalled();
    });

    it('sftp:move:success 应显示成功通知', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      triggerMessage(
        'sftp:move:success',
        { sources: ['/home/user/file.txt'], destination: '/home/user/archive', items: null },
        {}
      );

      expect(mockShowSuccess).toHaveBeenCalled();
    });
  });

  describe('操作错误消息处理', () => {
    it('sftp:mkdir:error 应显示错误通知', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      triggerMessage('sftp:mkdir:error', 'Permission denied', { type: 'sftp:mkdir:error' });

      expect(mockShowError).toHaveBeenCalled();
    });

    it('sftp:copy:error 应显示错误通知', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      triggerMessage('sftp:copy:error', 'Copy failed', { type: 'sftp:copy:error' });

      expect(mockShowError).toHaveBeenCalled();
    });

    it('sftp:move:error 应显示错误通知', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      triggerMessage('sftp:move:error', 'Move failed', { type: 'sftp:move:error' });

      expect(mockShowError).toHaveBeenCalled();
    });
  });

  describe('setInitialLoadDone', () => {
    it('应设置初始加载完成状态', () => {
      const manager = createSftpActionsManager('session-1', currentPathRef, createWsDeps(), mockT);

      expect(manager.initialLoadDone.value).toBe(false);

      manager.setInitialLoadDone(true);

      expect(manager.initialLoadDone.value).toBe(true);
    });
  });
});
