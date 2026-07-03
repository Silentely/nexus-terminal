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

describe('sendFileChunks', () => {
  const OriginalFileReader = globalThis.FileReader;

  beforeEach(() => {
    vi.useFakeTimers();
    globalThis.FileReader = MockFileReader as unknown as typeof FileReader;
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.FileReader = OriginalFileReader;
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
});
