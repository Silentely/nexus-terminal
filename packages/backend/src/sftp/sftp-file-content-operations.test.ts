import { describe, expect, it, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'events';
import * as iconv from 'iconv-lite';
import { detectAndDecodeSftpFileContent } from './sftp-encoding.utils';
import {
  executeReadFileContentOperation,
  executeWriteFileContentOperation,
} from './sftp-file-content-operations';
import type { ClientState } from '../websocket/types';

vi.mock('iconv-lite', () => ({
  default: {
    encode: vi.fn((content: string) => Buffer.from(content, 'utf8')),
  },
  encode: vi.fn((content: string) => Buffer.from(content, 'utf8')),
}));

vi.mock('./sftp-encoding.utils', () => ({
  detectAndDecodeSftpFileContent: vi.fn(() => ({
    encodingUsed: 'utf-8',
    decodedContent: 'ok',
  })),
}));

type MockSftp = {
  createReadStream: ReturnType<typeof vi.fn>;
  createWriteStream: ReturnType<typeof vi.fn>;
  lstat: ReturnType<typeof vi.fn>;
};

type MockState = ClientState & {
  ws: {
    send: ReturnType<typeof vi.fn>;
  };
  sftp: MockSftp;
};

class MockWriteStream extends EventEmitter {
  end = vi.fn((_: Buffer) => {
    setTimeout(() => this.emit('close'), 0);
  });
}

const createState = (): MockState => {
  return {
    ws: { send: vi.fn(), readyState: 1 },
    sftp: {
      createReadStream: vi.fn(),
      createWriteStream: vi.fn(),
      lstat: vi.fn(),
    },
  } as unknown as MockState;
};

const parseLastPayload = (sendMock: ReturnType<typeof vi.fn>): Record<string, unknown> => {
  const [raw] = sendMock.mock.calls.at(-1) ?? [];
  return JSON.parse(String(raw)) as Record<string, unknown>;
};

const flushAsync = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const createMockStats = () => ({
  size: 12,
  uid: 1000,
  gid: 1000,
  mode: 0o644,
  atime: 1710000000,
  mtime: 1710000001,
  isDirectory: () => false,
  isFile: () => true,
  isSymbolicLink: () => false,
});

describe('sftp-file-content-operations', () => {
  const sessionId = 'session-file';
  const requestId = 'req-file';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('executeReadFileContentOperation', () => {
    it('SFTP 未就绪时返回错误消息', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeReadFileContentOperation(state, sessionId, '/tmp/a.txt', requestId);

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:readfile:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('读取成功时应返回 base64 内容与 encodingUsed', async () => {
      const state = createState();
      const readStream = new EventEmitter();
      state.sftp.createReadStream.mockReturnValue(readStream);

      await executeReadFileContentOperation(state, sessionId, '/tmp/a.txt', requestId, 'utf-8');
      readStream.emit('data', Buffer.from('hello'));
      readStream.emit('end');

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:readfile:success');
      expect(payload.path).toBe('/tmp/a.txt');
      expect(payload.payload).toEqual({
        rawContentBase64: Buffer.from('hello').toString('base64'),
        encodingUsed: 'utf-8',
      });
      expect(vi.mocked(detectAndDecodeSftpFileContent)).toHaveBeenCalled();
    });

    it('读取流错误时返回 readfile:error', async () => {
      const state = createState();
      const readStream = new EventEmitter();
      state.sftp.createReadStream.mockReturnValue(readStream);

      await executeReadFileContentOperation(state, sessionId, '/tmp/a.txt', requestId);
      readStream.emit('error', new Error('stream failed'));

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:readfile:error');
      expect(payload.payload).toBe('读取文件流错误: stream failed');
    });

    it('编码检测失败时返回 readfile:error', async () => {
      const state = createState();
      const readStream = new EventEmitter();
      state.sftp.createReadStream.mockReturnValue(readStream);
      vi.mocked(detectAndDecodeSftpFileContent).mockImplementationOnce(() => {
        throw new Error('decode failed');
      });

      await executeReadFileContentOperation(state, sessionId, '/tmp/a.txt', requestId);
      readStream.emit('data', Buffer.from('hello'));
      readStream.emit('end');

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:readfile:error');
      expect(payload.payload).toBe('文件编码检测或转换失败: decode failed');
    });
  });

  describe('executeWriteFileContentOperation', () => {
    it('SFTP 未就绪时返回错误消息', async () => {
      const state = { ws: { send: vi.fn(), readyState: 1 } } as unknown as MockState;
      await executeWriteFileContentOperation(state, sessionId, '/tmp/a.txt', 'x', requestId);

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:writefile:error');
      expect(payload.payload).toBe('SFTP 会话未就绪');
    });

    it('编码失败时返回 writefile:error', async () => {
      const state = createState();
      vi.mocked(iconv.encode).mockImplementationOnce(() => {
        throw new Error('bad encoding');
      });

      await executeWriteFileContentOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        'content',
        requestId,
        'bad-enc',
      );

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:writefile:error');
      expect(payload.payload).toBe('无效的编码或编码失败: bad-enc');
    });

    it('写入成功且 lstat 成功时返回带 attrs 的 success', async () => {
      const state = createState();
      const stream = new MockWriteStream();
      state.sftp.createWriteStream.mockReturnValue(stream);
      state.sftp.lstat
        .mockImplementationOnce(
          (
            _path: string,
            callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
          ) => {
            callback(null, createMockStats());
          },
        )
        .mockImplementationOnce(
          (
            _path: string,
            callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
          ) => {
            callback(null, createMockStats());
          },
        );

      await executeWriteFileContentOperation(state, sessionId, '/tmp/a.txt', 'content', requestId);
      await flushAsync();

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:writefile:success');
      expect(payload.path).toBe('/tmp/a.txt');
      expect(payload.payload).toMatchObject({
        filename: 'a.txt',
        attrs: { isFile: true },
      });
      expect(stream.end).toHaveBeenCalled();
    });

    it('写入内容应与发送内容完全一致（UTF-8）', async () => {
      const state = createState();
      const stream = new MockWriteStream();
      const endSpy = vi.fn((_: Buffer) => {
        setTimeout(() => stream.emit('close'), 0);
      });
      stream.end = endSpy;
      state.sftp.createWriteStream.mockReturnValue(stream);
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => {
          callback(null, createMockStats());
        },
      );

      const testContent = '你好世界 Hello World こんにちは';
      await executeWriteFileContentOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        testContent,
        requestId,
      );
      await flushAsync();

      // 验证写入流的 buffer 内容与原始内容一致
      expect(endSpy).toHaveBeenCalledTimes(1);
      const writtenBuffer = endSpy.mock.calls[0][0] as Buffer;
      expect(writtenBuffer.toString('utf-8')).toBe(testContent);
    });

    it('写入内容应保持 CRLF 不被转换', async () => {
      const state = createState();
      const stream = new MockWriteStream();
      const endSpy = vi.fn((_: Buffer) => {
        setTimeout(() => stream.emit('close'), 0);
      });
      stream.end = endSpy;
      state.sftp.createWriteStream.mockReturnValue(stream);
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => {
          callback(null, createMockStats());
        },
      );

      const contentWithCRLF = 'line1\r\nline2\rline3\nline4';
      await executeWriteFileContentOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        contentWithCRLF,
        requestId,
      );
      await flushAsync();

      const writtenBuffer = endSpy.mock.calls[0][0] as Buffer;
      // CRLF 应保持不变，不被转换为 LF
      expect(writtenBuffer.toString('utf-8')).toBe(contentWithCRLF);
      // 验证 buffer 中确实包含 \r\n 字节序列（0x0D 0x0A）
      const bufferStr = writtenBuffer.toString('latin1');
      expect(bufferStr).toContain('\r\n');
    });

    it('写入 GBK 编码内容应正确编码', async () => {
      const state = createState();
      const stream = new MockWriteStream();
      const endSpy = vi.fn((_: Buffer) => {
        setTimeout(() => stream.emit('close'), 0);
      });
      stream.end = endSpy;
      state.sftp.createWriteStream.mockReturnValue(stream);
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => {
          callback(null, createMockStats());
        },
      );

      // iconv.encode mock 返回 Buffer.from(content, 'utf8')
      const testContent = 'test content';
      await executeWriteFileContentOperation(
        state,
        sessionId,
        '/tmp/a.txt',
        testContent,
        requestId,
        'gbk',
      );
      await flushAsync();

      // 验证 iconv.encode 被正确调用
      expect(vi.mocked(iconv.encode)).toHaveBeenCalledWith(testContent, 'gbk');
      expect(endSpy).toHaveBeenCalledTimes(1);
    });

    it('写入成功但 lstat 失败时返回 success 且 payload=null', async () => {
      const state = createState();
      const stream = new MockWriteStream();
      state.sftp.createWriteStream.mockReturnValue(stream);
      state.sftp.lstat
        .mockImplementationOnce((_path: string, callback: (err: Error | null) => void) => {
          callback(new Error('not found'));
        })
        .mockImplementationOnce((_path: string, callback: (err: Error | null) => void) => {
          callback(new Error('still not found'));
        });

      await executeWriteFileContentOperation(state, sessionId, '/tmp/a.txt', 'content', requestId);
      await flushAsync();

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:writefile:success');
      expect(payload.payload).toBeNull();
    });

    it('写入流错误时返回 writefile:error', async () => {
      const state = createState();
      const stream = new MockWriteStream();
      stream.end = vi.fn(() => {
        setTimeout(() => stream.emit('error', new Error('write stream failed')), 0);
      });
      state.sftp.createWriteStream.mockReturnValue(stream);
      state.sftp.lstat.mockImplementation(
        (
          _path: string,
          callback: (err: Error | null, stats?: ReturnType<typeof createMockStats>) => void,
        ) => {
          callback(null, createMockStats());
        },
      );

      await executeWriteFileContentOperation(state, sessionId, '/tmp/a.txt', 'content', requestId);
      await flushAsync();

      const payload = parseLastPayload(state.ws.send);
      expect(payload.type).toBe('sftp:writefile:error');
      expect(payload.payload).toBe('写入文件流错误: write stream failed');
    });
  });
});
