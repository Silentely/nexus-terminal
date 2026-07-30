/**
 * 压缩/解压与目录下载链路的真实协议集成复现测试
 *
 * 使用真实 ssh2 Server + Client（完整 SSH/SFTP 协议以及通道流控），
 * 对以下两个问题做端到端验证：
 *
 * 1. issue #112「解压功能不好使」：
 *    - 解压大量文件时 unzip/tar -v 将全部文件名写到 stdout；
 *    - 当前后端只消费 stderr，不消费 stdout，SSH 通道窗口耗尽后命令挂起，
 *      stream 永远不触发 close，前端 120 秒后报"解压超时"。
 *    - unzip 缺失时后端应发 sftp:command_not_found，且该消息有详细说明。
 *
 * 2. issue #113「两个连接窗口，第二个窗口下载 zip 压缩文件会失败」：
 *    - 两个会话（模拟两个连接窗口）各自/并发下载同一目录并打包成 zip，
 *      zip 内容必须完整可用（可被 adm-zip 解析并还原全部文件内容）。
 */
import { PassThrough } from 'stream';
import { describe, test, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { Client } from 'ssh2';
import type { SFTPWrapper } from 'ssh2';
import AdmZip from 'adm-zip';
import WebSocket from 'ws';

import { RealSshServer } from '../ssh/real-ssh-server';
// 注意引用顺序：必须先加载 sftp.controller（它会经由 websocket/state -> SftpService
// 初始化 SftpArchiveManager），否则直接引用 SftpArchiveManager 会触发循环依赖
import { downloadDirectory } from '../../../src/sftp/sftp.controller';
import { SftpArchiveManager } from '../../../src/sftp/sftp-archive.manager';
import { clientStates } from '../../../src/websocket';
import type { ClientState } from '../../../src/websocket/types';

const USERNAME = 'testuser';
const PASSWORD = 'testpass';

/** 捕获 WebSocket 消息的 mock client */
function createMockWs(userId: number) {
  const sent: Array<{ type: string; payload: unknown; sid?: string }> = [];
  const ws = {
    userId,
    readyState: WebSocket.OPEN,
    OPEN: WebSocket.OPEN,
    send: vi.fn((raw: string) => {
      try {
        const msg = JSON.parse(raw) as { type: string; payload: unknown; sid?: string };
        sent.push(msg);
      } catch {
        // 忽略非 JSON
      }
    }),
  };
  return { ws, sent };
}

/** 建立真实 SSH 会话并注册到 clientStates */
async function createRealSession(port: number, sessionId: string, userId = 1) {
  const sshClient = new Client();
  await new Promise<void>((resolve, reject) => {
    sshClient
      .on('ready', () => resolve())
      .on('error', reject)
      .connect({
        host: '127.0.0.1',
        port,
        username: USERNAME,
        password: PASSWORD,
        readyTimeout: 10000,
      });
  });
  const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
    sshClient.sftp((err, wrapper) => (err ? reject(err) : resolve(wrapper)));
  });
  const { ws, sent } = createMockWs(userId);
  const state = {
    ws,
    sshClient,
    sftp,
    dbConnectionId: 1,
    ipAddress: '127.0.0.1',
  } as unknown as ClientState;
  clientStates.set(sessionId, state);
  return { state, sshClient, sent };
}

/** 等待指定类型的消息到达，超时返回 null */
function waitForMessage(
  sent: Array<{ type: string; payload: unknown }>,
  type: string,
  timeoutMs: number,
): Promise<{ type: string; payload: unknown } | null> {
  const startedAt = Date.now();
  return new Promise((resolve) => {
    const poll = setInterval(() => {
      const found = sent.find((m) => m.type === type);
      if (found) {
        clearInterval(poll);
        resolve(found);
      } else if (Date.now() - startedAt > timeoutMs) {
        clearInterval(poll);
        resolve(null);
      }
    }, 50);
  });
}

function buildFakeRes() {
  const stream = new PassThrough();
  const headers: Record<string, string> = {};
  const res = Object.assign(stream, {
    statusCode: 200,
    headersSent: false,
    headers,
    setHeader(name: string, value: string) {
      headers[name] = value;
      this.headersSent = true;
    },
    status(code: number) {
      this.statusCode = code;
      return this as unknown as PassThrough;
    },
    json(body: unknown) {
      (res as unknown as { jsonBody: unknown }).jsonBody = body;
      return this as unknown as PassThrough;
    },
  });
  return res as unknown as PassThrough & {
    statusCode: number;
    headersSent: boolean;
    headers: Record<string, string>;
    setHeader: (n: string, v: string) => void;
    status: (c: number) => unknown;
    json: (b: unknown) => unknown;
  };
}

function collectStream(stream: NodeJS.ReadableStream): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', (c: Buffer) => chunks.push(c));
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

describe('真实协议集成复现：压缩/解压 + 目录下载', () => {
  let server: RealSshServer;
  let port: number;

  beforeAll(async () => {
    server = new RealSshServer();
    port = await server.start();
  }, 20000);

  afterAll(async () => {
    for (const [sid, state] of clientStates.entries()) {
      try {
        state.sftp?.end();
        state.sshClient?.end();
      } catch {
        // 忽略清理异常
      }
      clientStates.delete(sid);
    }
    await server.stop();
  });

  afterEach(() => {
    for (const [sid, state] of clientStates.entries()) {
      try {
        state.sftp?.end();
        state.sshClient?.end();
      } catch {
        // 忽略清理异常
      }
      clientStates.delete(sid);
    }
  });

  describe('解压（issue #112）', () => {
    test(
      '解压大量文件名输出到 stdout 时仍应成功（回归：不消费 stdout 会致通道流控挂起）',
      { timeout: 30000 },
      async () => {
        // 150k 行 stdout ≈ 3.6MB，超过 ssh2 默认通道窗口（2MB）
        const { sent } = await createRealSession(port, 'session-decompress');
        const manager = new SftpArchiveManager(clientStates);

        await manager.decompress('session-decompress', {
          archivePath: '/home/testuser/archive.zip',
          requestId: 'req-decompress',
        });

        const success = await waitForMessage(sent, 'sftp:decompress:success', 15000);
        expect(
          success,
          '解压完成后必须收到 sftp:decompress:success（未收到说明通道挂起）',
        ).not.toBeNull();
      },
    );

    test('tar.gz 解压大量文件名输出到 stdout 时仍应成功', { timeout: 30000 }, async () => {
      const { sent } = await createRealSession(port, 'session-decompress-tar');
      const manager = new SftpArchiveManager(clientStates);

      await manager.decompress('session-decompress-tar', {
        archivePath: '/home/testuser/archive.tar.gz',
        requestId: 'req-decompress-tar',
      });

      const success = await waitForMessage(sent, 'sftp:decompress:success', 15000);
      expect(success).not.toBeNull();
    });

    test(
      '服务器缺少 unzip 时应收到 sftp:command_not_found（用于前端立即失败而不是等待 120 秒超时）',
      { timeout: 15000 },
      async () => {
        const noUnzipServer = new RealSshServer({ hasUnzip: false });
        const p2 = await noUnzipServer.start();
        try {
          const { sent } = await createRealSession(p2, 'session-no-unzip');
          const manager = new SftpArchiveManager(clientStates);

          await manager.decompress('session-no-unzip', {
            archivePath: '/home/testuser/archive.zip',
            requestId: 'req-no-unzip',
          });

          const message = await waitForMessage(sent, 'sftp:command_not_found', 10000);
          expect(message).not.toBeNull();
          expect(message?.payload).toMatchObject({
            operation: 'decompress',
            command: 'unzip',
          });
        } finally {
          await noUnzipServer.stop();
        }
      },
    );
  });

  describe('目录压缩下载（issue #113）', () => {
    test('两个窗口同名连接的目录下载都应得到完整 zip', { timeout: 60000 }, async () => {
      // 模拟两个连接窗口：两个独立 SSH 会话指向同一个数据库连接
      await createRealSession(port, 'session-window-1');
      const { sent: sent2 } = await createRealSession(port, 'session-window-2');

      const downloadFrom = async (sessionId: string, remotePath: string) => {
        const res = buildFakeRes();
        const bodyPromise = collectStream(res);
        const req = {
          session: { userId: 1 },
          query: { connectionId: '1', sessionId, remotePath },
        };
        const next = (err?: unknown) => {
          throw new Error(`next() 被调用: ${String(err)}`);
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await downloadDirectory(req as any, res as any, next as any);
        const zipBuffer = await bodyPromise;
        const zip = new AdmZip(zipBuffer);
        return { res, entries: zip.getEntries().map((ent) => ent.entryName) };
      };

      // 窗口 2（失败重现场景）
      const w2 = await downloadFrom('session-window-2', '/home/testuser/data');
      expect(w2.res.statusCode).toBe(200);
      expect(w2.entries).toContain('file-0.txt');
      expect(w2.entries).toContain('file-39.txt');
      expect(w2.entries.some((e) => e.startsWith('nested/'))).toBe(true);

      // 窗口 1 作为对照
      const w1 = await downloadFrom('session-window-1', '/home/testuser/data');
      expect(w1.res.statusCode).toBe(200);
      expect(w1.entries.length).toBe(w2.entries.length);

      // 同一窗口再次下载（复现"第二次/第二个窗口失败"的可能性）
      const w2again = await downloadFrom('session-window-2', '/home/testuser/data');
      expect(w2again.res.statusCode).toBe(200);
      expect(w2again.entries.length).toBe(w2.entries.length);

      expect(sent2.find((m) => m.type === 'sftp_error')).toBeUndefined();
    });

    test(
      '会话存在但 SFTP 实例缺失时应按需重建并完成下载（issue #113 修复验证）',
      { timeout: 30000 },
      async () => {
        const { state } = await createRealSession(port, 'session-stale-sftp');

        // 模拟 SFTP 通道被服务端关闭后，end/close/error 处理器把 state.sftp 置空的情形
        state.sftp?.end();
        state.sftp = undefined;

        const res = buildFakeRes();
        const bodyPromise = collectStream(res);
        const req = {
          session: { userId: 1 },
          query: {
            connectionId: '1',
            sessionId: 'session-stale-sftp',
            remotePath: '/home/testuser/data',
          },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await downloadDirectory(
          req as any,
          res as any,
          ((err?: unknown) => {
            throw err instanceof Error ? err : new Error(String(err));
          }) as any,
        );
        const zipBuffer = await bodyPromise;
        const names = new AdmZip(zipBuffer).getEntries().map((e) => e.entryName);
        expect(res.statusCode).toBe(200);
        expect(names).toContain('file-0.txt');
        expect(names).toContain('file-39.txt');
        // 重建成功后 state.sftp 应恢复
        expect(state.sftp).toBeDefined();
      },
    );

    test('两个窗口并发目录下载都有效', { timeout: 60000 }, async () => {
      await createRealSession(port, 'session-c1');
      await createRealSession(port, 'session-c2');

      const downloadFrom = async (sessionId: string) => {
        const res = buildFakeRes();
        const bodyPromise = collectStream(res);
        const req = {
          session: { userId: 1 },
          query: { connectionId: '1', sessionId, remotePath: '/home/testuser/data' },
        };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await downloadDirectory(
          req as any,
          res as any,
          ((err?: unknown) => {
            throw err instanceof Error ? err : new Error(String(err));
          }) as any,
        );
        // bodyPromise 在请求开始前已挂好监听，复用同一个即可；
        // 不可在 resolved 后再次 collectStream，否则错过 PassThrough 的 end 事件
        return bodyPromise;
      };

      const [b1, b2] = await Promise.all([downloadFrom('session-c1'), downloadFrom('session-c2')]);
      for (const buf of [b1, b2]) {
        const zip = new AdmZip(buf);
        const names = zip.getEntries().map((e) => e.entryName);
        expect(names).toContain('file-0.txt');
        expect(names).toContain('file-39.txt');
      }
    });
  });
});
