import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientState } from '../websocket/types';
import { executeCopyOperation } from './sftp-copy-operations';

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

type MockReadableStream = EventEmitter & {
  destroy: ReturnType<typeof vi.fn>;
  pipe: ReturnType<typeof vi.fn>;
};

type MockWritableStream = EventEmitter & {
  destroy: ReturnType<typeof vi.fn>;
};

type MockSftp = {
  lstat: ReturnType<typeof vi.fn>;
  mkdir: ReturnType<typeof vi.fn>;
  readdir: ReturnType<typeof vi.fn>;
  createReadStream: ReturnType<typeof vi.fn>;
  createWriteStream: ReturnType<typeof vi.fn>;
};

type MockState = ClientState & {
  ws: { send: ReturnType<typeof vi.fn> };
  sftp: MockSftp;
};

const createMockStats = (kind: 'file' | 'directory' = 'file'): MockStats => ({
  size: 16,
  uid: 1000,
  gid: 1000,
  mode: 0o644,
  atime: 1710000000,
  mtime: 1710000001,
  isDirectory: () => kind === 'directory',
  isFile: () => kind === 'file',
  isSymbolicLink: () => false,
});

const createReadable = (errorMessage?: string): MockReadableStream => {
  const readable = new EventEmitter() as MockReadableStream;
  readable.destroy = vi.fn();
  readable.pipe = vi.fn((dest: MockWritableStream) => {
    if (errorMessage) {
      setImmediate(() => readable.emit('error', new Error(errorMessage)));
    } else {
      setImmediate(() => dest.emit('close'));
    }
    return dest;
  });
  return readable;
};

const createWritable = (): MockWritableStream => {
  const writable = new EventEmitter() as MockWritableStream;
  writable.destroy = vi.fn();
  return writable;
};

const createState = (): MockState => {
  return {
    ws: { send: vi.fn(), readyState: 1, readyState: 1 },
    sftp: {
      lstat: vi.fn(),
      mkdir: vi.fn(),
      readdir: vi.fn(),
      createReadStream: vi.fn(),
      createWriteStream: vi.fn(),
    },
  } as unknown as MockState;
};

const parseLastPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

describe('sftp-copy-operations', () => {
  const sessionId = 'session-copy';
  const requestId = 'req-copy';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('SFTP 未就绪时返回 copy:error', async () => {
    const state = { ws: { send: vi.fn(), readyState: 1, readyState: 1 } } as unknown as MockState;
    await executeCopyOperation(state, sessionId, ['/tmp/a.txt'], '/tmp/dest', requestId);
    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:copy:error');
    expect(payload.payload).toBe('SFTP 会话未就绪');
    expect(payload.requestId).toBe(requestId);
  });

  it('copy 成功时返回 copy:success 且包含目标 items', async () => {
    const state = createState();
    state.sftp.lstat.mockImplementation(
      (path: string, callback: (err: Error | null, stats?: MockStats) => void) => {
        if (path === '/tmp/dest') {
          callback(null, createMockStats('directory'));
          return;
        }
        if (path === '/tmp/src/a.txt') {
          callback(null, createMockStats('file'));
          return;
        }
        if (path === '/tmp/dest/a.txt') {
          callback(null, createMockStats('file'));
          return;
        }
        callback(new Error(`unexpected path: ${path}`));
      },
    );
    state.sftp.createReadStream.mockImplementation(() => createReadable());
    state.sftp.createWriteStream.mockImplementation(() => createWritable());

    await executeCopyOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:copy:success');
    expect(payload.requestId).toBe(requestId);
    expect(payload.payload).toMatchObject({
      destination: '/tmp/dest',
      items: [{ filename: 'a.txt', attrs: { isFile: true } }],
    });
  });

  it('目标目录检查失败时返回 copy:error', async () => {
    const state = createState();
    state.sftp.lstat.mockImplementation(
      (_path: string, callback: (err: Error | null, stats?: MockStats) => void) => {
        const err = new Error('permission denied') as Error & { code?: string };
        err.code = 'EACCES';
        callback(err);
      },
    );

    await executeCopyOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:copy:error');
    expect(String(payload.payload)).toContain('复制操作失败: 无法创建或访问目标目录:');
  });

  it('复制文件流失败时返回 copy:error', async () => {
    const state = createState();
    state.sftp.lstat.mockImplementation(
      (path: string, callback: (err: Error | null, stats?: MockStats) => void) => {
        if (path === '/tmp/dest') {
          callback(null, createMockStats('directory'));
          return;
        }
        if (path === '/tmp/src/a.txt') {
          callback(null, createMockStats('file'));
          return;
        }
        callback(new Error(`unexpected path: ${path}`));
      },
    );
    state.sftp.createReadStream.mockImplementation(() => createReadable('stream broken'));
    state.sftp.createWriteStream.mockImplementation(() => createWritable());

    await executeCopyOperation(state, sessionId, ['/tmp/src/a.txt'], '/tmp/dest', requestId);

    const payload = parseLastPayload(state.ws.send);
    expect(payload.type).toBe('sftp:copy:error');
    expect(String(payload.payload)).toContain('复制操作失败: 复制文件失败: stream broken');
  });
});
