import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ref } from 'vue';
import { useFileUploader } from './useFileUploader';

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

vi.mock('./useUploadChunkManager', () => ({
  sendFileChunks: vi.fn(),
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function makeWsDeps(overrides: Record<string, any> = {}) {
  return ref({
    isConnected: { value: true },
    isSftpReady: { value: true },
    sendMessage: vi.fn(),
    onMessage: vi.fn().mockReturnValue(vi.fn()),
    ...overrides,
  } as any);
}

function makeFile(name = 'test.txt', size = 1024): File {
  return new File(['x'.repeat(size)], name, { type: 'text/plain' });
}

describe('useFileUploader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('应返回 uploads、startFileUpload 和 cancelUpload', () => {
    const sessionId = ref('s1');
    const currentPath = ref('/home');
    const fileList = ref([]) as any;
    const wsDeps = makeWsDeps();

    const result = useFileUploader(sessionId, currentPath, fileList, wsDeps);

    expect(result.uploads).toBeDefined();
    expect(typeof result.startFileUpload).toBe('function');
    expect(typeof result.cancelUpload).toBe('function');
  });

  describe('startFileUpload', () => {
    it('应创建上传任务并发送开始消息', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      const file = makeFile();
      startFileUpload(file);

      const uploadIds = Object.keys(uploads);
      expect(uploadIds).toHaveLength(1);
      expect(uploads[uploadIds[0]].filename).toBe('test.txt');
      expect(uploads[uploadIds[0]].status).toBe('pending');
      expect(wsDeps.value.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sftp:upload:start' }),
      );
    });

    it('WebSocket 未连接时应忽略', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps({ isConnected: { value: false } });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());

      expect(Object.keys(uploads)).toHaveLength(0);
    });

    it('带 relativePath 时应正确拼接路径', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { startFileUpload } = useFileUploader(sessionId, currentPath, fileList, wsDeps);

      const file = makeFile('doc.txt');
      startFileUpload(file, 'subfolder');

      expect(wsDeps.value.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            remotePath: '/home/subfolder/doc.txt',
          }),
        }),
      );
    });

    it('根路径 / 应正确拼接', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { startFileUpload } = useFileUploader(sessionId, currentPath, fileList, wsDeps);

      startFileUpload(makeFile('a.txt'));

      expect(wsDeps.value.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            remotePath: '/a.txt',
          }),
        }),
      );
    });

    it('路径中多余斜杠应被规范化', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home//user/');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { startFileUpload } = useFileUploader(sessionId, currentPath, fileList, wsDeps);

      startFileUpload(makeFile('a.txt'));

      expect(wsDeps.value.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            remotePath: '/home/user/a.txt',
          }),
        }),
      );
    });

    it('文件夹上传时应避免文件名重复拼接', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { startFileUpload } = useFileUploader(sessionId, currentPath, fileList, wsDeps);

      // webkitRelativePath 格式: folder/filename.txt
      const file = makeFile('doc.txt');
      Object.defineProperty(file, 'webkitRelativePath', { value: 'myfolder/doc.txt' });
      startFileUpload(file, 'myfolder/doc.txt');

      expect(wsDeps.value.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          payload: expect.objectContaining({
            remotePath: '/home/myfolder/doc.txt',
          }),
        }),
      );
    });

    it('文件夹多文件上传应排队启动，完成后自动补位', async () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const handlers = new Map<string, Function>();
      const wsDeps = makeWsDeps({
        onMessage: vi.fn((type: string, handler: Function) => {
          handlers.set(type, handler);
          return vi.fn();
        }),
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      for (let i = 0; i < 10; i++) {
        startFileUpload(makeFile(`file-${i}.txt`));
      }

      expect(Object.keys(uploads)).toHaveLength(10);
      expect(wsDeps.value.sendMessage).toHaveBeenCalledTimes(8);

      const firstUploadId = Object.keys(uploads)[0];
      handlers.get('sftp:upload:success')?.(
        { uploadId: firstUploadId },
        { type: 'sftp:upload:success' },
      );
      await Promise.resolve();

      expect(wsDeps.value.sendMessage).toHaveBeenCalledTimes(9);
    });

    it('上传开始消息发送失败时不应永久占用启动槽位', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const sendMessage = vi.fn().mockReturnValueOnce(false).mockReturnValue(true);
      const wsDeps = makeWsDeps({ sendMessage });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      for (let i = 0; i < 9; i++) {
        startFileUpload(makeFile(`file-${i}.txt`));
      }

      expect(sendMessage).toHaveBeenCalledTimes(9);
      const failedUpload = Object.values(uploads).find(
        (upload) => upload.filename === 'file-0.txt',
      );
      expect(failedUpload?.status).toBe('error');
    });

    it('上传开始消息发送失败后应自动移除错误条目', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const sendMessage = vi.fn().mockReturnValue(false);
      const wsDeps = makeWsDeps({ sendMessage });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile('failed-start.txt'));
      const uploadId = Object.keys(uploads)[0];

      expect(uploads[uploadId].status).toBe('error');
      vi.advanceTimersByTime(5000);

      expect(uploads[uploadId]).toBeUndefined();
    });

    it('开始消息已成功写入时不应被之后的连接状态翻转标记失败', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const isConnected = { value: true };
      const sendMessage = vi.fn().mockImplementation(() => {
        isConnected.value = false;
        return true;
      });
      const wsDeps = makeWsDeps({ isConnected, sendMessage });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile('sent-before-disconnect.txt'));
      const uploadId = Object.keys(uploads)[0];

      expect(uploads[uploadId].status).toBe('pending');
      expect((uploads[uploadId] as any).startRequested).toBe(true);
    });
  });

  describe('cancelUpload', () => {
    it('应将上传状态设为 cancelled', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { uploads, startFileUpload, cancelUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];

      cancelUpload(uploadId);

      expect(uploads[uploadId].status).toBe('cancelled');
    });

    it('应发送取消消息到后端', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { uploads, startFileUpload, cancelUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      wsDeps.value.sendMessage.mockClear();

      cancelUpload(uploadId, true);

      expect(wsDeps.value.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'sftp:upload:cancel' }),
      );
    });

    it('notifyBackend=false 时不应发送消息', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { uploads, startFileUpload, cancelUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      wsDeps.value.sendMessage.mockClear();

      cancelUpload(uploadId, false);

      expect(wsDeps.value.sendMessage).not.toHaveBeenCalled();
    });

    it('cancelled 状态的上传应在延迟后被移除', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { uploads, startFileUpload, cancelUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];

      cancelUpload(uploadId);
      expect(uploads[uploadId]).toBeDefined();

      vi.advanceTimersByTime(3000);
      expect(uploads[uploadId]).toBeUndefined();
    });

    it('不存在的 uploadId 应被忽略', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { cancelUpload } = useFileUploader(sessionId, currentPath, fileList, wsDeps);

      cancelUpload('nonexistent');

      // 不应抛出错误
    });

    it('已完成的上传不应被取消', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const { uploads, startFileUpload, cancelUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'success';

      cancelUpload(uploadId);

      expect(uploads[uploadId].status).toBe('success');
    });
  });

  describe('消息处理器', () => {
    it('onUploadReady 应将状态改为 uploading', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      // 捕获 onMessage 注册的回调
      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];

      // 模拟后端响应 upload:ready
      messageHandlers['sftp:upload:ready']({ uploadId }, { uploadId });

      expect(uploads[uploadId].status).toBe('uploading');
    });

    it('onUploadSuccess 应将上传标记为成功并移除', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'uploading';

      messageHandlers['sftp:upload:success']({ uploadId }, { uploadId });

      expect(uploads[uploadId]).toBeUndefined();
    });

    it('onUploadError 应将状态设为 error', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];

      messageHandlers['sftp:upload:error']({ uploadId, message: '磁盘空间不足' }, { uploadId });

      expect(uploads[uploadId].status).toBe('error');
      expect(uploads[uploadId].error).toBe('磁盘空间不足');

      // 错误应在延迟后被移除
      vi.advanceTimersByTime(5000);
      expect(uploads[uploadId]).toBeUndefined();
    });

    it('onUploadPause 应将状态设为 paused', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'uploading';

      messageHandlers['sftp:upload:pause']({}, { uploadId });

      expect(uploads[uploadId].status).toBe('paused');
    });

    it('onUploadResume 应恢复上传', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'paused';

      messageHandlers['sftp:upload:resume']({}, { uploadId });

      expect(uploads[uploadId].status).toBe('uploading');
    });

    it('onUploadCancelled 应清理上传', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];

      messageHandlers['sftp:upload:cancelled']({}, { uploadId });

      vi.advanceTimersByTime(3000);
      expect(uploads[uploadId]).toBeUndefined();
    });

    it('onUploadProgress 应更新进度', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'uploading';

      messageHandlers['sftp:upload:progress']({ bytesWritten: 512, totalSize: 1024 }, { uploadId });

      expect(uploads[uploadId].progress).toBe(50);
    });

    it('onUploadProgress 应取乐观进度与后端确认进度的较大值', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      // 创建 10KB 文件
      startFileUpload(makeFile('big.bin', 10240));
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'uploading';

      // 模拟前端已发送 8KB（乐观进度 80%）
      uploads[uploadId].sentBytes = 8192;

      // 后端确认进度仅 50%（5KB/10KB）
      messageHandlers['sftp:upload:progress'](
        { bytesWritten: 5120, totalSize: 10240 },
        { uploadId },
      );

      // 应取较大值 80%
      expect(uploads[uploadId].progress).toBe(80);
    });

    it('onUploadProgress 不应在后端成功前把乐观进度四舍五入到 100', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile('almost.bin', 10000));
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'uploading';
      uploads[uploadId].sentBytes = 9950;

      messageHandlers['sftp:upload:progress'](
        { bytesWritten: 5000, totalSize: 10000 },
        { uploadId },
      );

      expect(uploads[uploadId].progress).toBe(99);
    });

    it('totalSize 为 0 时进度应为 100 而非 NaN', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      const { uploads, startFileUpload } = useFileUploader(
        sessionId,
        currentPath,
        fileList,
        wsDeps,
      );

      startFileUpload(makeFile());
      const uploadId = Object.keys(uploads)[0];
      uploads[uploadId].status = 'uploading';

      // 后端发送 totalSize=0 的进度消息（空文件场景）
      messageHandlers['sftp:upload:progress']({ bytesWritten: 0, totalSize: 0 }, { uploadId });

      expect(uploads[uploadId].progress).toBe(100);
      expect(Number.isNaN(uploads[uploadId].progress)).toBe(false);
    });

    it('缺少 uploadId 的消息应被忽略', () => {
      const sessionId = ref('s1');
      const currentPath = ref('/home');
      const fileList = ref([]) as any;
      const wsDeps = makeWsDeps();

      const messageHandlers: Record<string, Function> = {};
      wsDeps.value.onMessage = vi.fn().mockImplementation((type: string, handler: Function) => {
        messageHandlers[type] = handler;
        return vi.fn();
      });

      useFileUploader(sessionId, currentPath, fileList, wsDeps);

      // 不应抛出错误
      messageHandlers['sftp:upload:ready']({}, {});
      messageHandlers['sftp:upload:success']({}, {});
      messageHandlers['sftp:upload:error']({}, {});
    });
  });
});
