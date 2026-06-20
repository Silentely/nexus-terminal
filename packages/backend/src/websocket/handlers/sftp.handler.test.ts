/**
 * SFTP WebSocket Handler 单元测试
 * 测试 SFTP 文件操作的 WebSocket 消息处理逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import WebSocket from 'ws';

import {
  handleSftpOperation,
  handleSftpUploadStart,
  handleSftpUploadChunk,
  handleSftpUploadCancel,
} from './sftp.handler';
import { AuthenticatedWebSocket, ClientState } from '../types';
import { clientStates } from '../state';

// Mock state module services
vi.mock('../state', async (importOriginal) => {
  const original = await importOriginal<typeof import('../state')>();
  return {
    ...original,
    clientStates: new Map<string, ClientState>(),
    sftpService: {
      readdir: vi.fn(),
      stat: vi.fn(),
      readFile: vi.fn(),
      writefile: vi.fn(),
      mkdir: vi.fn(),
      rmdir: vi.fn(),
      unlink: vi.fn(),
      rename: vi.fn(),
      chmod: vi.fn(),
      realpath: vi.fn(),
      copy: vi.fn(),
      move: vi.fn(),
      compress: vi.fn(),
      decompress: vi.fn(),
      startUpload: vi.fn(),
      handleUploadChunk: vi.fn(),
      cancelUpload: vi.fn(),
    },
  };
});

// Helper to create mock WebSocket
function createMockWebSocket(
  overrides: Partial<AuthenticatedWebSocket> = {},
): AuthenticatedWebSocket {
  const ws = new EventEmitter() as AuthenticatedWebSocket;
  ws.readyState = WebSocket.OPEN;
  ws.send = vi.fn();
  ws.close = vi.fn();
  ws.userId = 1;
  ws.username = 'testuser';
  ws.sessionId = undefined;
  Object.assign(ws, overrides);
  return ws;
}

// Helper to create mock ClientState
function createMockClientState(ws: AuthenticatedWebSocket): ClientState {
  return {
    ws,
    sshClient: {} as any,
    dbConnectionId: 1,
    isShellReady: true,
  };
}

describe('SFTP WebSocket Handler', () => {
  let mockWs: AuthenticatedWebSocket;

  beforeEach(() => {
    vi.clearAllMocks();
    clientStates.clear();
    mockWs = createMockWebSocket();
  });

  afterEach(() => {
    clientStates.clear();
  });

  describe('handleSftpOperation', () => {
    it('无活动会话时应发送错误消息', async () => {
      await handleSftpOperation(mockWs, 'sftp:readdir', { path: '/home' }, 'req-1');

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'sftp_error',
          payload: { message: '无效的会话', requestId: 'req-1' },
        }),
      );
    });

    it('缺少 requestId 时应发送错误消息', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:readdir', { path: '/home' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'sftp_error',
          payload: { message: 'SFTP 操作 sftp:readdir 缺少 requestId' },
          sid: 'test-session',
        }),
      );
    });

    it('应正确处理 sftp:readdir 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:readdir', { path: '/home' }, 'req-1');

      expect(sftpService.readdir).toHaveBeenCalledWith('test-session', '/home', 'req-1');
    });

    it('sftp:readdir 缺少 path 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:readdir', {}, 'req-1');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'path' in payload for readdir"),
      );
    });

    it('应正确处理 sftp:stat 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:stat', { path: '/home/test.txt' }, 'req-2');

      expect(sftpService.stat).toHaveBeenCalledWith('test-session', '/home/test.txt', 'req-2');
    });

    it('应正确处理 sftp:readfile 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:readfile',
        { path: '/home/test.txt', encoding: 'utf8' },
        'req-3',
      );

      expect(sftpService.readFile).toHaveBeenCalledWith(
        'test-session',
        '/home/test.txt',
        'req-3',
        'utf8',
      );
    });

    it('应正确处理 sftp:writefile 操作并保持原始内容', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:writefile',
        { path: '/home/test.txt', content: 'line1\r\nline2\rline3' },
        'req-4',
      );

      // 不再进行 CRLF 转换，保持原始内容不变
      expect(sftpService.writefile).toHaveBeenCalledWith(
        'test-session',
        '/home/test.txt',
        'line1\r\nline2\rline3',
        'req-4',
        undefined,
      );
    });

    it('writefile 拒绝时应发送 sftp_error', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      vi.mocked(sftpService.writefile).mockRejectedValueOnce(new Error('disk full'));

      await handleSftpOperation(
        mockWs,
        'sftp:writefile',
        { path: '/home/test.txt', content: 'data' },
        'req-4c',
      );

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('处理 SFTP 请求 sftp:writefile 时出错'),
      );
      const sent = JSON.parse(mockWs.send.mock.calls[0][0] as string);
      expect(sent.type).toBe('sftp_error');
      expect(sent.payload.requestId).toBe('req-4c');
    });

    it('writefile 缺少 path 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:writefile', { content: 'data' }, 'req-4d');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'path' in payload for writefile"),
      );
    });

    it('writefile 当 content 和 data 同时存在时应优先使用 content', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:writefile',
        { path: '/home/test.txt', content: 'from-content', data: 'from-data' },
        'req-4e',
      );

      expect(sftpService.writefile).toHaveBeenCalledWith(
        'test-session',
        '/home/test.txt',
        'from-content',
        'req-4e',
        undefined,
      );
    });

    it('writefile 当 content 不存在时应回退到 data', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:writefile',
        { path: '/home/test.txt', data: 'from-data' },
        'req-4f',
      );

      expect(sftpService.writefile).toHaveBeenCalledWith(
        'test-session',
        '/home/test.txt',
        'from-data',
        'req-4f',
        undefined,
      );
    });

    it('writefile 当 content 和 data 都不存在时应拒绝写入', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:writefile', { path: '/home/test.txt' }, 'req-4g');

      // 缺少 content/data 时不应调用 writefile，而是发送错误
      expect(sftpService.writefile).not.toHaveBeenCalled();
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing 'content' or 'data'"),
      );
    });

    it('writefile 当 payload 非对象时应安全降级', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      // payload 为 undefined/空对象时不应崩溃
      await handleSftpOperation(mockWs, 'sftp:writefile', {}, 'req-4h');

      // 缺少 path 应报错
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'path' in payload for writefile"),
      );
    });

    it('mkdir 缺少 path 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:mkdir', {}, 'req-5b');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'path' in payload for mkdir"),
      );
    });

    it('unlink 缺少 path 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:unlink', {}, 'req-7b');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'path' in payload for unlink"),
      );
    });

    it('rename 缺少 newPath 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:rename', { oldPath: '/home/old.txt' }, 'req-8b');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'oldPath' or 'newPath' in payload for rename"),
      );
    });

    it('chmod 缺少 mode 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:chmod', { path: '/home/file.txt' }, 'req-9b');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining("Missing or unsafe 'path' or invalid 'mode' in payload for chmod"),
      );
    });

    it('copy 缺少 destination 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:copy', { sources: ['/home/file1.txt'] }, 'req-11b');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining(
          "Missing or unsafe 'sources' (array) or 'destination' in payload for copy",
        ),
      );
    });

    it('move 缺少 sources 时应抛出错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:move', { destination: '/backup' }, 'req-12b');

      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining(
          "Missing or unsafe 'sources' (array) or 'destination' in payload for move",
        ),
      );
    });

    it('应正确传递 encoding 参数给 writefile', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:writefile',
        { path: '/home/test.txt', content: 'hello', encoding: 'gbk' },
        'req-4b',
      );

      expect(sftpService.writefile).toHaveBeenCalledWith(
        'test-session',
        '/home/test.txt',
        'hello',
        'req-4b',
        'gbk',
      );
    });

    it('应正确处理 sftp:mkdir 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:mkdir', { path: '/home/newdir' }, 'req-5');

      expect(sftpService.mkdir).toHaveBeenCalledWith('test-session', '/home/newdir', 'req-5');
    });

    it('应正确处理 sftp:rmdir 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:rmdir', { path: '/home/olddir' }, 'req-6');

      expect(sftpService.rmdir).toHaveBeenCalledWith('test-session', '/home/olddir', 'req-6');
    });

    it('应正确处理 sftp:unlink 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:unlink', { path: '/home/file.txt' }, 'req-7');

      expect(sftpService.unlink).toHaveBeenCalledWith('test-session', '/home/file.txt', 'req-7');
    });

    it('应正确处理 sftp:rename 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:rename',
        { oldPath: '/home/old.txt', newPath: '/home/new.txt' },
        'req-8',
      );

      expect(sftpService.rename).toHaveBeenCalledWith(
        'test-session',
        '/home/old.txt',
        '/home/new.txt',
        'req-8',
      );
    });

    it('应正确处理 sftp:chmod 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:chmod',
        { path: '/home/file.txt', mode: 0o755 },
        'req-9',
      );

      expect(sftpService.chmod).toHaveBeenCalledWith(
        'test-session',
        '/home/file.txt',
        0o755,
        'req-9',
      );
    });

    it('应正确处理 sftp:realpath 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:realpath', { path: '~/documents' }, 'req-10');

      expect(sftpService.realpath).toHaveBeenCalledWith('test-session', '~/documents', 'req-10');
    });

    it('应正确处理 sftp:copy 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:copy',
        { sources: ['/home/file1.txt', '/home/file2.txt'], destination: '/backup' },
        'req-11',
      );

      expect(sftpService.copy).toHaveBeenCalledWith(
        'test-session',
        ['/home/file1.txt', '/home/file2.txt'],
        '/backup',
        'req-11',
      );
    });

    it('应正确处理 sftp:move 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:move',
        { sources: ['/home/file1.txt'], destination: '/archive' },
        'req-12',
      );

      expect(sftpService.move).toHaveBeenCalledWith(
        'test-session',
        ['/home/file1.txt'],
        '/archive',
        'req-12',
      );
    });

    it('应正确处理 sftp:compress 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:compress',
        {
          sources: ['/home/dir1', '/home/file1.txt'],
          destination: '/backup/archive.zip',
          format: 'zip',
        },
        'req-13',
      );

      expect(sftpService.compress).toHaveBeenCalledWith('test-session', {
        sources: ['/home/dir1', '/home/file1.txt'],
        destinationArchiveName: 'archive.zip',
        format: 'zip',
        targetDirectory: '/backup',
        requestId: 'req-13',
      });
    });

    it('应正确处理 sftp:decompress 操作', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(
        mockWs,
        'sftp:decompress',
        { source: '/backup/archive.tar.gz' },
        'req-14',
      );

      expect(sftpService.decompress).toHaveBeenCalledWith('test-session', {
        archivePath: '/backup/archive.tar.gz',
        requestId: 'req-14',
      });
    });

    it('未知 SFTP 操作类型应发送错误', async () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpOperation(mockWs, 'sftp:unknown', {}, 'req-15');

      expect(mockWs.send).toHaveBeenCalledWith(expect.stringContaining('内部未处理的 SFTP 类型'));
    });

    it('WebSocket 关闭时不应发送消息', async () => {
      mockWs.readyState = WebSocket.CLOSED;

      await handleSftpOperation(mockWs, 'sftp:readdir', { path: '/home' }, 'req-16');

      expect(mockWs.send).not.toHaveBeenCalled();
    });
  });

  describe('handleSftpUploadStart', () => {
    it('无活动会话时应发送错误', () => {
      handleSftpUploadStart(mockWs, {
        uploadId: 'upload-1',
        remotePath: '/home/test.txt',
        size: 1024,
      });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: 'upload-1', message: '无效的会话' },
        }),
      );
    });

    it('缺少必要参数时应发送错误', () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      handleSftpUploadStart(mockWs, { uploadId: 'upload-1' });

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: 'upload-1', message: '缺少 uploadId, remotePath 或 size' },
          sid: 'test-session',
        }),
      );
    });

    it('应正确启动上传', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      handleSftpUploadStart(mockWs, {
        uploadId: 'upload-1',
        remotePath: '/home/test.txt',
        size: 1024,
        relativePath: 'folder/test.txt',
      });

      expect(sftpService.startUpload).toHaveBeenCalledWith(
        'test-session',
        'upload-1',
        '/home/test.txt',
        1024,
        'folder/test.txt',
      );
    });
  });

  describe('handleSftpUploadChunk', () => {
    it('无活动会话时应静默忽略', async () => {
      const { sftpService } = await import('../state');

      await handleSftpUploadChunk(mockWs, {
        uploadId: 'upload-1',
        chunkIndex: 0,
        data: 'base64data',
      });

      expect(sftpService.handleUploadChunk).not.toHaveBeenCalled();
    });

    it('缺少必要参数时应静默忽略', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpUploadChunk(mockWs, { uploadId: 'upload-1' });

      expect(sftpService.handleUploadChunk).not.toHaveBeenCalled();
    });

    it('应正确处理上传块', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpUploadChunk(mockWs, {
        uploadId: 'upload-1',
        chunkIndex: 0,
        data: 'base64data',
      });

      expect(sftpService.handleUploadChunk).toHaveBeenCalledWith(
        'test-session',
        'upload-1',
        0,
        'base64data',
        undefined,
      );
    });

    it('应允许零字节文件上传块（data 为空字符串）', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      await handleSftpUploadChunk(mockWs, {
        uploadId: 'upload-empty',
        chunkIndex: 0,
        data: '',
        isLast: true,
      });

      expect(sftpService.handleUploadChunk).toHaveBeenCalledWith(
        'test-session',
        'upload-empty',
        0,
        '',
        true,
      );
    });
  });

  describe('handleSftpUploadCancel', () => {
    it('无活动会话时应静默忽略', async () => {
      const { sftpService } = await import('../state');

      handleSftpUploadCancel(mockWs, { uploadId: 'upload-1' });

      expect(sftpService.cancelUpload).not.toHaveBeenCalled();
    });

    it('缺少 uploadId 时应发送错误', () => {
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      handleSftpUploadCancel(mockWs, {});

      expect(mockWs.send).toHaveBeenCalledWith(
        JSON.stringify({
          type: 'sftp:upload:error',
          payload: { uploadId: undefined, message: '缺少 uploadId' },
          sid: 'test-session',
        }),
      );
    });

    it('应正确取消上传', async () => {
      const { sftpService } = await import('../state');
      mockWs.sessionId = 'test-session';
      const state = createMockClientState(mockWs);
      clientStates.set('test-session', state);

      handleSftpUploadCancel(mockWs, { uploadId: 'upload-1' });

      expect(sftpService.cancelUpload).toHaveBeenCalledWith('test-session', 'upload-1');
    });
  });
});
