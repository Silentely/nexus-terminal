import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import type { ClientState } from '../websocket/types';
import {
  executeMkdirPathOperation,
  executeRenamePathOperation,
  executeRmdirPathOperation,
  executeUnlinkPathOperation,
} from './sftp-path-operations';

type MockSftp = {
  mkdir: ReturnType<typeof vi.fn>;
  lstat: ReturnType<typeof vi.fn>;
  unlink: ReturnType<typeof vi.fn>;
  rename: ReturnType<typeof vi.fn>;
};

type MockState = ClientState & {
  ws: {
    send: ReturnType<typeof vi.fn>;
    readyState: number;
  };
  sftp: MockSftp;
  sshClient: {
    exec: ReturnType<typeof vi.fn>;
  };
};

const decodeWsPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

const createMockStats = () => ({
  size: 1,
  uid: 1000,
  gid: 1000,
  mode: 0o755,
  atime: 1710000000,
  mtime: 1710000001,
  isDirectory: () => true,
  isFile: () => false,
  isSymbolicLink: () => false,
});

const createState = (): MockState => {
  return {
    ws: { send: vi.fn(), readyState: 1 },
    sftp: {
      mkdir: vi.fn(),
      lstat: vi.fn(),
      unlink: vi.fn(),
      rename: vi.fn(),
    },
    sshClient: {
      exec: vi.fn(),
    },
  } as unknown as MockState;
};

const flushAsyncEvents = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

describe('sftp-path-operations', () => {
  const sessionId = 'session-a';
  const requestId = 'req-a';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeMkdirPathOperation', () => {
    it('SFTP 未就绪时返回错误消息', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeMkdirPathOperation(state, sessionId, '/tmp/dir', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:mkdir:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('mkdir 成功且 lstat 成功时返回新目录信息', async () => {
      const state = createState();
      state.sftp.mkdir.mockImplementation((_path: string, callback: (err?: Error) => void) => {
        callback();
      });
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => {
          callback(null, createMockStats());
        },
      );

      await executeMkdirPathOperation(state, sessionId, '/tmp/dir', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:mkdir:success');
      expect(payload.path).toBe('/tmp/dir');
      expect(payload.payload).toMatchObject({
        filename: 'dir',
        attrs: {
          isDirectory: true,
        },
      });
    });

    it('mkdir 失败时返回错误消息', async () => {
      const state = createState();
      state.sftp.mkdir.mockImplementation((_path: string, callback: (err?: Error) => void) => {
        callback(new Error('mkdir failed'));
      });

      await executeMkdirPathOperation(state, sessionId, '/tmp/dir', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:mkdir:error');
      expect(payload.payload).toBe('创建目录失败: mkdir failed');
    });

    it('mkdir 后 lstat 失败时仍返回 success 且 payload=null', async () => {
      const state = createState();
      state.sftp.mkdir.mockImplementation((_path: string, callback: (err?: Error) => void) => {
        callback();
      });
      state.sftp.lstat.mockImplementation((_path: string, callback: (err: Error | null) => void) =>
        callback(new Error('lstat failed')),
      );

      await executeMkdirPathOperation(state, sessionId, '/tmp/dir', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:mkdir:success');
      expect(payload.payload).toBeNull();
    });
  });

  describe('executeRmdirPathOperation', () => {
    it('SSH 客户端未就绪时返回错误消息', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeRmdirPathOperation(state, sessionId, '/tmp/dir', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rmdir:error');
      expect(payload.payload).toBe('SSH 会话未就绪');
    });

    it('exec 启动失败时返回错误消息', async () => {
      const state = createState();
      state.sshClient.exec.mockImplementation(
        (_command: string, callback: (err?: Error, stream?: EventEmitter) => void) => {
          callback(new Error('exec failed'));
        },
      );

      await executeRmdirPathOperation(state, sessionId, '/tmp/dir', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rmdir:error');
      expect(payload.payload).toBe('删除目录失败: rm -rf 命令执行失败: exec failed');
    });

    it('exec close code=0 时返回 success', async () => {
      const state = createState();
      state.sshClient.exec.mockImplementation(
        (_command: string, callback: (err?: Error, stream?: EventEmitter) => void) => {
          const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
          stream.stderr = new EventEmitter();
          callback(undefined, stream);
          setTimeout(() => {
            stream.emit('close', 0, null);
          }, 0);
        },
      );

      await executeRmdirPathOperation(state, sessionId, '/tmp/dir', requestId);
      await flushAsyncEvents();

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rmdir:success');
      expect(payload.path).toBe('/tmp/dir');
    });

    it('exec 非 0 退出码时返回 stderr 错误消息', async () => {
      const state = createState();
      state.sshClient.exec.mockImplementation(
        (_command: string, callback: (err?: Error, stream?: EventEmitter) => void) => {
          const stream = new EventEmitter() as EventEmitter & { stderr: EventEmitter };
          stream.stderr = new EventEmitter();
          callback(undefined, stream);
          setTimeout(() => {
            stream.stderr.emit('data', Buffer.from('permission denied'));
            stream.emit('close', 1, null);
          }, 0);
        },
      );

      await executeRmdirPathOperation(state, sessionId, '/tmp/dir', requestId);
      await flushAsyncEvents();

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rmdir:error');
      expect(payload.payload).toBe('删除目录失败: permission denied');
    });
  });

  describe('executeUnlinkPathOperation', () => {
    it('SFTP 未就绪时返回错误消息', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeUnlinkPathOperation(state, sessionId, '/tmp/a.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:unlink:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('unlink 失败时返回错误消息', async () => {
      const state = createState();
      state.sftp.unlink.mockImplementation((_path: string, callback: (err?: Error) => void) => {
        callback(new Error('unlink failed'));
      });

      await executeUnlinkPathOperation(state, sessionId, '/tmp/a.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:unlink:error');
      expect(payload.payload).toBe('删除文件失败: unlink failed');
    });

    it('unlink 成功时返回 success', async () => {
      const state = createState();
      state.sftp.unlink.mockImplementation((_path: string, callback: (err?: Error) => void) => {
        callback();
      });

      await executeUnlinkPathOperation(state, sessionId, '/tmp/a.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:unlink:success');
      expect(payload.path).toBe('/tmp/a.txt');
    });
  });

  describe('executeRenamePathOperation', () => {
    it('SFTP 未就绪时返回错误消息', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeRenamePathOperation(state, sessionId, '/tmp/a.txt', '/tmp/b.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rename:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('rename 失败时返回错误消息', async () => {
      const state = createState();
      state.sftp.rename.mockImplementation(
        (_oldPath: string, _newPath: string, callback: (err?: Error) => void) => {
          callback(new Error('rename failed'));
        },
      );

      await executeRenamePathOperation(state, sessionId, '/tmp/a.txt', '/tmp/b.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rename:error');
      expect(payload.payload).toBe('重命名/移动失败: rename failed');
    });

    it('rename 成功且 lstat 成功时返回新路径信息', async () => {
      const state = createState();
      state.sftp.rename.mockImplementation(
        (_oldPath: string, _newPath: string, callback: (err?: Error) => void) => {
          callback();
        },
      );
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => {
          callback(null, createMockStats());
        },
      );

      await executeRenamePathOperation(state, sessionId, '/tmp/a.txt', '/tmp/b.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rename:success');
      expect(payload.payload).toMatchObject({
        oldPath: '/tmp/a.txt',
        newPath: '/tmp/b.txt',
        newItem: {
          filename: 'b.txt',
        },
      });
    });

    it('rename 成功但 lstat 失败时返回 success 且 newItem=null', async () => {
      const state = createState();
      state.sftp.rename.mockImplementation(
        (_oldPath: string, _newPath: string, callback: (err?: Error) => void) => {
          callback();
        },
      );
      state.sftp.lstat.mockImplementation((_path: string, callback: (err: Error | null) => void) =>
        callback(new Error('lstat failed')),
      );

      await executeRenamePathOperation(state, sessionId, '/tmp/a.txt', '/tmp/b.txt', requestId);

      const payload = decodeWsPayload(state.ws.send);
      expect(payload.type).toBe('sftp:rename:success');
      expect(payload.payload).toEqual({
        oldPath: '/tmp/a.txt',
        newPath: '/tmp/b.txt',
        newItem: null,
      });
    });
  });
});
