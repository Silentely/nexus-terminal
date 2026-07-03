import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientState } from '../websocket/types';
import { executeReaddirSftpOperation } from './sftp-readdir-operations';

type MockStats = {
  size: number;
  uid: number;
  gid: number;
  mode: number;
  atime: number;
  mtime: number;
  isDirectory: () => boolean;
  isFile: () => boolean;
  isSymbolicLink: () => boolean;
};

type MockReaddirEntry = {
  filename: string;
  longname: string;
  attrs: MockStats;
};

type MockSftp = {
  readdir: ReturnType<typeof vi.fn>;
};

type MockState = ClientState & {
  ws: { send: ReturnType<typeof vi.fn> };
  sftp: MockSftp;
};

const createMockStats = (kind: 'file' | 'directory' = 'file'): MockStats => ({
  size: 128,
  uid: 1000,
  gid: 1000,
  mode: 0o644,
  atime: 1710000000,
  mtime: 1710000001,
  isDirectory: () => kind === 'directory',
  isFile: () => kind === 'file',
  isSymbolicLink: () => false,
});

const createState = (): MockState => {
  return {
    ws: { send: vi.fn(), readyState: 1, readyState: 1 }, // readyState: 1 = OPEN
    sftp: {
      readdir: vi.fn(),
    },
  } as unknown as MockState;
};

const parseLastPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

describe('sftp-readdir-operations', () => {
  const sessionId = 'session-readdir';
  const requestId = 'req-readdir';
  const path = '/tmp';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SFTP 未就绪时返回 readdir:error', async () => {
    const state = { ws: { send: vi.fn(), readyState: 1, readyState: 1 } } as unknown as MockState;
    await executeReaddirSftpOperation(state, sessionId, path, requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:readdir:error');
    expect(payload.path).toBe(path);
    expect(payload.payload).toBe('SFTP 会话未就绪');
    expect(payload.requestId).toBe(requestId);
  });

  it('readdir 回调报错时返回 readdir:error', async () => {
    const state = createState();
    state.sftp.readdir.mockImplementation(
      (_path: string, callback: (err: Error | null, list?: MockReaddirEntry[]) => void) =>
        callback(new Error('permission denied')),
    );

    await executeReaddirSftpOperation(state, sessionId, path, requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:readdir:error');
    expect(payload.path).toBe(path);
    expect(payload.payload).toBe('读取目录失败: permission denied');
    expect(payload.requestId).toBe(requestId);
  });

  it('readdir 成功时返回 readdir:success 且保持 payload 结构', async () => {
    const state = createState();
    const entries: MockReaddirEntry[] = [
      {
        filename: 'demo.txt',
        longname: '-rw-r--r-- 1 user group 128 demo.txt',
        attrs: createMockStats('file'),
      },
      {
        filename: 'folder',
        longname: 'drwxr-xr-x 2 user group 64 folder',
        attrs: createMockStats('directory'),
      },
    ];
    state.sftp.readdir.mockImplementation(
      (_path: string, callback: (err: Error | null, list?: MockReaddirEntry[]) => void) =>
        callback(null, entries),
    );

    await executeReaddirSftpOperation(state, sessionId, path, requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:readdir:success');
    expect(payload.path).toBe(path);
    expect(payload.requestId).toBe(requestId);
    expect(payload.payload).toMatchObject([
      {
        filename: 'demo.txt',
        longname: '-rw-r--r-- 1 user group 128 demo.txt',
        attrs: {
          atime: 1710000000000,
          mtime: 1710000001000,
          isFile: true,
          isDirectory: false,
        },
      },
      {
        filename: 'folder',
        longname: 'drwxr-xr-x 2 user group 64 folder',
        attrs: {
          atime: 1710000000000,
          mtime: 1710000001000,
          isFile: false,
          isDirectory: true,
        },
      },
    ]);
  });
});
