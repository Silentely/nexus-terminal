import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientState } from '../websocket/types';
import { executeMoveOperation } from './sftp-move-operations';

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

type MockSftp = {
  lstat: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
};

type MockState = ClientState & {
  ws: { send: ReturnType<typeof vi.fn> };
  sftp: MockSftp;
};

const createMockStats = (kind: 'file' | 'directory' = 'file'): MockStats => ({
  size: 32,
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
    ws: { send: vi.fn(), readyState: 1, readyState: 1 },
    sftp: {
      lstat: vi.fn(),
      mkdir: vi.fn(),
      rename: vi.fn(),
    },
  } as unknown as MockState;
};

const createError = (message: string, code?: string): Error & { code?: string } => {
  const error = new Error(message) as Error & { code?: string };
  error.code = code;
  return error;
};

const parseLastPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

describe('sftp-move-operations', () => {
  const sessionId = 'session-move';
  const requestId = 'req-move';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SFTP 未就绪时返回 move:error', async () => {
    const state = { ws: { send: vi.fn(), readyState: 1, readyState: 1 } } as unknown as MockState;
    await executeMoveOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:move:error');
    expect(payload.payload).toBe('SFTP 会话未就绪');
    expect(payload.requestId).toBe(requestId);
  });

  it('目标已存在时返回 move:error', async () => {
    const state = createState();
    state.sftp.lstat.mockImplementation(
      (path: string, callback: (err: Error | null, stats?: MockStats) => void) => {
        if (path === '/tmp/dest') {
          callback(null, createMockStats('directory'));
          return;
        }
        if (path === '/tmp/dest/a.txt') {
          callback(null, createMockStats('file'));
          return;
        }
        callback(createError(`unexpected path: ${path}`));
      },
    );

    await executeMoveOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:move:error');
    expect(String(payload.payload)).toContain('移动操作失败: 目标路径 a.txt 已存在');
    expect(state.sftp.rename).not.toHaveBeenCalled();
  });

  it('移动成功时返回 move:success', async () => {
    const state = createState();
    const statCallCounter = new Map<string, number>();
    state.sftp.lstat.mockImplementation(
      (path: string, callback: (err: Error | null, stats?: MockStats) => void) => {
        const count = (statCallCounter.get(path) ?? 0) + 1;
        statCallCounter.set(path, count);

        if (path === '/tmp/dest') {
          callback(null, createMockStats('directory'));
          return;
        }
        if (path === '/tmp/dest/a.txt' && count === 1) {
          callback(createError('No such file', 'ENOENT'));
          return;
        }
        if (path === '/tmp/dest/a.txt' && count >= 2) {
          callback(null, createMockStats('file'));
          return;
        }
        callback(createError(`unexpected path: ${path}`));
      },
    );
    state.sftp.rename.mockImplementation(
      (_oldPath: string, _newPath: string, callback: (err?: Error) => void) => callback(),
    );

    await executeMoveOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:move:success');
    expect(payload.requestId).toBe(requestId);
    expect(payload.payload).toMatchObject({
      sources: ['/tmp/src/a.txt'],
      destination: '/tmp/dest',
      items: [{ filename: 'a.txt', attrs: { isFile: true } }],
    });
    expect(state.sftp.rename).toHaveBeenCalledWith(
      '/tmp/src/a.txt',
      '/tmp/dest/a.txt',
      expect.any(Function),
    );
  });

  it('目标目录不可达时返回 move:error', async () => {
    const state = createState();
    state.sftp.lstat.mockImplementation(
      (_path: string, callback: (err: Error | null, stats?: MockStats) => void) => {
        callback(createError('permission denied', 'EACCES'));
      },
    );

    await executeMoveOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:move:error');
    expect(String(payload.payload)).toContain('移动操作失败: 无法创建或访问目标目录:');
    expect(state.sftp.rename).not.toHaveBeenCalled();
  });
});
