import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientState } from '../websocket/types';
import {
  executeCleanupSftpSessionOperation,
  executeInitializeSftpSessionOperation,
} from './sftp-session-operations';

class MockSftpWrapper extends EventEmitter {
  end = vi.fn();
}

class MockSshClient extends EventEmitter {
  sftp = vi.fn();
}

type MockState = ClientState & {
  ws: { send: ReturnType<typeof vi.fn> };
  sshClient: MockSshClient;
  sftp?: MockSftpWrapper;
  dbConnectionId: number;
};

const parseLastPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

describe('sftp-session-operations', () => {
  const sessionId = 'session-sftp-lifecycle';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('初始化成功时应发送 sftp_ready 并写入 state.sftp', async () => {
    const mockSftp = new MockSftpWrapper();
    const mockSshClient = new MockSshClient();
    const send = vi.fn();
    const state = {
      ws: { send, readyState: 1 },
      sshClient: mockSshClient,
      sftp: undefined,
      dbConnectionId: 101,
    } as unknown as MockState;

    mockSshClient.sftp.mockImplementation(
      (callback: (err?: Error, sftp?: MockSftpWrapper) => void) => callback(undefined, mockSftp),
    );

    await executeInitializeSftpSessionOperation(state, sessionId);

    expect(state.sftp).toBe(mockSftp);
    const payload = parseLastPayload(send);
    expect(payload.type).toBe('sftp_ready');
    expect(payload.payload).toMatchObject({ connectionId: 101 });
  });

  it('初始化失败时应发送 sftp_error 并抛出错误', async () => {
    const mockSshClient = new MockSshClient();
    const send = vi.fn();
    const state = {
      ws: { send, readyState: 1 },
      sshClient: mockSshClient,
      sftp: undefined,
      dbConnectionId: 202,
    } as unknown as MockState;

    mockSshClient.sftp.mockImplementation((callback: (err?: Error) => void) =>
      callback(new Error('SFTP 初始化失败')),
    );

    await expect(executeInitializeSftpSessionOperation(state, sessionId)).rejects.toThrow(
      'SFTP 初始化失败',
    );
    const payload = parseLastPayload(send);
    expect(payload.type).toBe('sftp_error');
    expect(payload.payload).toMatchObject({ connectionId: 202, message: 'SFTP 初始化失败' });
  });

  it('状态无效或已初始化时不处理', async () => {
    await expect(
      executeInitializeSftpSessionOperation(undefined, sessionId),
    ).resolves.toBeUndefined();

    const mockSftp = new MockSftpWrapper();
    const mockSshClient = new MockSshClient();
    const send = vi.fn();
    const state = {
      ws: { send },
      sshClient: mockSshClient,
      sftp: mockSftp,
      dbConnectionId: 303,
    } as unknown as MockState;

    await executeInitializeSftpSessionOperation(state, sessionId);
    expect(mockSshClient.sftp).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('cleanup 应关闭并清理会话中的 sftp', () => {
    const mockSftp = new MockSftpWrapper();
    const state = {
      ws: { send: vi.fn() },
      sshClient: new MockSshClient(),
      sftp: mockSftp,
      dbConnectionId: 404,
    } as unknown as MockState;

    executeCleanupSftpSessionOperation(state, sessionId);

    expect(mockSftp.end).toHaveBeenCalledTimes(1);
    expect(state.sftp).toBeUndefined();
  });
});
