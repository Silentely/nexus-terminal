import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';
import { sendFileChunks, type ChunkManagerDeps } from './useUploadChunkManager';
import type { UploadItem } from '../types/upload.types';

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

class MockFileReader {
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(blob: Blob): void {
    void blob.arrayBuffer().then((buffer) => {
      const base64 = Buffer.from(buffer).toString('base64');
      this.onload?.({ target: { result: `data:application/octet-stream;base64,${base64}` } });
    });
  }
}

class ControlledFileReader {
  static readers: ControlledFileReader[] = [];
  onload: ((event: { target: { result: string } }) => void) | null = null;
  onerror: (() => void) | null = null;

  readAsDataURL(): void {
    ControlledFileReader.readers.push(this);
  }

  emitLoad(): void {
    this.onload?.({
      target: {
        result: 'data:application/octet-stream;base64,eA==',
      },
    });
  }
}

describe('sendFileChunks', () => {
  const OriginalFileReader = globalThis.FileReader;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
    ControlledFileReader.readers = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.FileReader = OriginalFileReader;
    ControlledFileReader.readers = [];
    vi.restoreAllMocks();
  });

  it('发送分块后应立即更新乐观进度', async () => {
    const file = new File([new Uint8Array(512 * 1024)], 'large.bin');
    const uploads: Record<string, UploadItem> = {
      'upload-1': {
        id: 'upload-1',
        file,
        filename: 'large.bin',
        progress: 0,
        sentBytes: 0,
        status: 'uploading',
      },
    };
    const sendMessage = vi.fn();
    const deps: ChunkManagerDeps = {
      uploads,
      sessionIdForLog: ref('session-1'),
      t: (key: string) => key,
      wsDeps: ref({
        isConnected: { value: true },
        isSftpReady: { value: true },
        sendMessage,
        onMessage: vi.fn().mockReturnValue(vi.fn()),
      } as any),
    };

    sendFileChunks(deps, 'upload-1', file);
    await vi.runAllTimersAsync();

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sftp:upload:chunk' }),
    );
    expect(uploads['upload-1'].sentBytes).toBeGreaterThan(0);
    expect(uploads['upload-1'].progress).toBeGreaterThan(0);
  });

  it('最后一块发送前乐观进度不应提前显示为 100', () => {
    globalThis.FileReader = ControlledFileReader as unknown as typeof FileReader;
    const firstChunkSize = 1024 * 256;
    const fileSize = Math.ceil(firstChunkSize / 0.995);
    const file = new File([new Uint8Array(fileSize)], 'almost.bin');
    const uploads: Record<string, UploadItem> = {
      'upload-1': {
        id: 'upload-1',
        file,
        filename: 'almost.bin',
        progress: 0,
        sentBytes: 0,
        status: 'uploading',
      },
    };
    const sendMessage = vi.fn();
    const deps: ChunkManagerDeps = {
      uploads,
      sessionIdForLog: ref('session-1'),
      t: (key: string) => key,
      wsDeps: ref({
        isConnected: { value: true },
        isSftpReady: { value: true },
        sendMessage,
        onMessage: vi.fn().mockReturnValue(vi.fn()),
      } as any),
    };

    sendFileChunks(deps, 'upload-1', file);
    expect(ControlledFileReader.readers).toHaveLength(2);

    ControlledFileReader.readers[0].emitLoad();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(uploads['upload-1'].sentBytes).toBe(firstChunkSize);
    expect(uploads['upload-1'].progress).toBe(99);
  });

  it('分块消息发送失败时不应推进乐观进度', () => {
    globalThis.FileReader = ControlledFileReader as unknown as typeof FileReader;
    const file = new File([new Uint8Array(1024)], 'failed.bin');
    const uploads: Record<string, UploadItem> = {
      'upload-1': {
        id: 'upload-1',
        file,
        filename: 'failed.bin',
        progress: 0,
        sentBytes: 0,
        status: 'uploading',
      },
    };
    const sendMessage = vi.fn().mockReturnValue(false);
    const unregisterAck = vi.fn();
    const onUploadFailed = vi.fn();
    const deps: ChunkManagerDeps = {
      uploads,
      sessionIdForLog: ref('session-1'),
      t: (key: string) => key,
      onUploadFailed,
      wsDeps: ref({
        isConnected: { value: true },
        isSftpReady: { value: true },
        sendMessage,
        onMessage: vi.fn().mockReturnValue(unregisterAck),
      } as any),
    };

    sendFileChunks(deps, 'upload-1', file);
    expect(ControlledFileReader.readers).toHaveLength(1);

    ControlledFileReader.readers[0].emitLoad();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(uploads['upload-1'].status).toBe('error');
    expect(uploads['upload-1'].error).toBe('fileManager.errors.uploadFailed');
    expect(uploads['upload-1'].sentBytes).toBe(0);
    expect(uploads['upload-1'].progress).toBe(0);
    expect(unregisterAck).toHaveBeenCalled();
    expect(onUploadFailed).toHaveBeenCalledWith('upload-1');
    expect(
      (uploads['upload-1'] as UploadItem & { _unregisterAck?: () => void })._unregisterAck,
    ).toBeUndefined();

    vi.advanceTimersByTime(5000);
    expect(uploads['upload-1']).toBeUndefined();
  });

  it('零字节文件分块消息发送失败时应标记上传失败', () => {
    const file = new File([], 'empty.bin');
    const uploads: Record<string, UploadItem> = {
      'upload-1': {
        id: 'upload-1',
        file,
        filename: 'empty.bin',
        progress: 0,
        sentBytes: 0,
        status: 'uploading',
      },
    };
    const sendMessage = vi.fn().mockReturnValue(false);
    const unregisterAck = vi.fn();
    const onUploadFailed = vi.fn();
    const deps: ChunkManagerDeps = {
      uploads,
      sessionIdForLog: ref('session-1'),
      t: (key: string) => key,
      onUploadFailed,
      wsDeps: ref({
        isConnected: { value: true },
        isSftpReady: { value: true },
        sendMessage,
        onMessage: vi.fn().mockReturnValue(unregisterAck),
      } as any),
    };

    sendFileChunks(deps, 'upload-1', file);

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sftp:upload:chunk' }),
    );
    expect(uploads['upload-1'].status).toBe('error');
    expect(uploads['upload-1'].progress).toBe(0);
    expect(unregisterAck).toHaveBeenCalled();
    expect(onUploadFailed).toHaveBeenCalledWith('upload-1');

    vi.advanceTimersByTime(5000);
    expect(uploads['upload-1']).toBeUndefined();
  });
});
