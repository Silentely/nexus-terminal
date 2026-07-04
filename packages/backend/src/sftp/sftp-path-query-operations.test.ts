import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { ClientState } from '../websocket/types';
import {
  executeChmodPathQueryOperation,
  executeRealpathPathQueryOperation,
  executeStatPathQueryOperation,
} from './sftp-path-query-operations';

type MockSftp = {
  lstat: ReturnType<typeof vi.fn>;
  chmod: ReturnType<typeof vi.fn>;
  realpath: ReturnType<typeof vi.fn>;
  stat: ReturnType<typeof vi.fn>;
};

type MockState = ClientState & {
  ws: {
    send: ReturnType<typeof vi.fn>;
  };
  sftp: MockSftp;
};

const createMockStats = (kind: 'file' | 'directory' = 'file') => ({
  size: 10,
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
    ws: { send: vi.fn(), readyState: 1 },
    sftp: {
      lstat: vi.fn(),
      chmod: vi.fn(),
      realpath: vi.fn(),
      stat: vi.fn(),
    },
  } as unknown as MockState;
};

const parseLastPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

describe('sftp-path-query-operations', () => {
  const sessionId = 'session-query';
  const requestId = 'req-query';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeStatPathQueryOperation', () => {
    it('SFTP 未就绪时返回错误', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeStatPathQueryOperation(state, sessionId, '/tmp/a.txt', requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:stat:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('lstat 失败时返回 stat:error', async () => {
      const state = createState();
      state.sftp.lstat.mockImplementation(
        (_path: string, callback: (err: Error | null) => void) => {
          callback(new Error('lstat failed'));
        },
      );
      await executeStatPathQueryOperation(state, sessionId, '/tmp/a.txt', requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:stat:error');
      expect(payload.payload).toBe('获取状态失败: lstat failed');
    });

    it('lstat 成功时返回 stat:success', async () => {
      const state = createState();
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => callback(null, createMockStats('file')),
      );
      await executeStatPathQueryOperation(state, sessionId, '/tmp/a.txt', requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:stat:success');
      expect(payload.payload).toMatchObject({
        isFile: true,
      });
    });
  });

  describe('executeChmodPathQueryOperation', () => {
    it('SFTP 未就绪时返回错误', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeChmodPathQueryOperation(state, sessionId, '/tmp/a.txt', 0o644, requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:chmod:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('chmod 失败时返回 chmod:error', async () => {
      const state = createState();
      state.sftp.chmod.mockImplementation(
        (_path: string, _mode: number, callback: (err?: Error) => void) =>
          callback(new Error('chmod failed')),
      );
      await executeChmodPathQueryOperation(state, sessionId, '/tmp/a.txt', 0o644, requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:chmod:error');
      expect(payload.payload).toBe('修改权限失败: chmod failed');
    });

    it('chmod 成功但 lstat 失败时返回 success + null', async () => {
      const state = createState();
      state.sftp.chmod.mockImplementation(
        (_path: string, _mode: number, callback: (err?: Error) => void) => callback(),
      );
      state.sftp.lstat.mockImplementation(
        (_path: string, callback: (err: Error | null) => void) => {
          callback(new Error('lstat failed'));
        },
      );
      await executeChmodPathQueryOperation(state, sessionId, '/tmp/a.txt', 0o644, requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:chmod:success');
      expect(payload.payload).toBeNull();
    });

    it('chmod + lstat 成功时返回 success + attrs', async () => {
      const state = createState();
      state.sftp.chmod.mockImplementation(
        (_path: string, _mode: number, callback: (err?: Error) => void) => callback(),
      );
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => callback(null, createMockStats('file')),
      );
      await executeChmodPathQueryOperation(state, sessionId, '/tmp/a.txt', 0o644, requestId);
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:chmod:success');
      expect(payload.payload).toMatchObject({
        filename: 'a.txt',
        attrs: { isFile: true },
      });
    });
  });

  describe('executeRealpathPathQueryOperation', () => {
    it('SFTP 未就绪时返回错误', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeRealpathPathQueryOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        requestId,
        () => state,
      );
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:realpath:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('realpath 失败时返回 realpath:error', async () => {
      const state = createState();
      state.sftp.realpath.mockImplementation(
        (_path: string, callback: (err: Error | null, absPath?: string) => void) =>
          callback(new Error('realpath failed')),
      );
      await executeRealpathPathQueryOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        requestId,
        () => state,
      );
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:realpath:error');
      expect(payload.payload).toMatchObject({
        requestedPath: '/tmp/a.txt',
        error: '获取绝对路径失败: realpath failed',
      });
    });

    it('realpath 成功但 currentState 失效时返回 realpath:error', async () => {
      const state = createState();
      state.sftp.realpath.mockImplementation(
        (_path: string, callback: (err: Error | null, absPath?: string) => void) =>
          callback(null, '/abs/a.txt'),
      );
      await executeRealpathPathQueryOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        requestId,
        () => undefined,
      );
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:realpath:error');
      expect(payload.payload).toMatchObject({
        requestedPath: '/tmp/a.txt',
        absolutePath: '/abs/a.txt',
        error: 'SFTP 会话在获取目标类型前已失效',
      });
    });

    it('realpath + stat 成功时返回 targetType', async () => {
      const state = createState();
      state.sftp.realpath.mockImplementation(
        (_path: string, callback: (err: Error | null, absPath?: string) => void) =>
          callback(null, '/abs/a.txt'),
      );
      state.sftp.stat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => callback(null, createMockStats('directory')),
      );
      await executeRealpathPathQueryOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        requestId,
        () => state,
      );
      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:realpath:success');
      expect(payload.payload).toMatchObject({
        requestedPath: '/tmp/a.txt',
        absolutePath: '/abs/a.txt',
        targetType: 'directory',
      });
    });
  });
});
