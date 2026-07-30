/**
 * 真实 ssh2 服务器（集成复现用）
 *
 * 与 mock-ssh-server.ts（伪协议模拟）不同，本实现基于 ssh2 库的 Server，
 * 走完整的 SSH/SFTP 协议与通道流控，可真实复现以下场景：
 * - 解压命令 stdout 未被消费时的通道窗口挂起
 * - 远程命令缺失（command -v 失败）时的 sftp:command_not_found 分支
 * - 多会话（多窗口）同时走同一个 SFTP 服务的目录压缩下载
 *
 * 解压命令行为：
 * - `command -v unzip` / `which unzip`：有 unzip 时输出路径，无 unzip 时 exit 1
 * - `unzip -o <archive>`：向 stdout 写 unzipInflatingLines 行 "  inflating: file_i.txt"，然后 exit 0
 *   （等效于解压 unzipInflatingLines 个文件的 zip 包）
 * - `tar -xzvf <archive>`：向 stdout 写 tarListLines 行文件名，然后 exit 0
 */
import { EventEmitter } from 'events';
import { Server, utils } from 'ssh2';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const SFTP_MODULE = require('ssh2/lib/protocol/SFTP.js') as {
  STATUS_CODE: Record<'OK' | 'EOF' | 'NO_SUCH_FILE' | 'PERMISSION_DENIED' | 'FAILURE', number>;
};
import type { ServerChannel, SFTPStream } from 'ssh2';

const SFTP_STATUS_CODE = SFTP_MODULE.STATUS_CODE;

export interface RealSshServerOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  /** 模拟服务器上是否安装 unzip */
  hasUnzip?: boolean;
  /** 模拟 unzip 输出的 "inflating" 行数（每行约 24 字节，150k 行 ≈ 3.6MB > 2MB 通道窗口） */
  unzipInflatingLines?: number;
  /** 模拟 tar -v 输出的文件行数 */
  tarListLines?: number;
}

interface TreeEntry {
  type: 'file' | 'directory';
  content: Buffer;
}

function buildDefaultTree(): Map<string, TreeEntry> {
  const tree = new Map<string, TreeEntry>();
  tree.set('/home/testuser', { type: 'directory', content: Buffer.alloc(0) });
  tree.set('/home/testuser/archive.zip', {
    type: 'file',
    content: Buffer.from('ZIP-BYTES'),
  });
  tree.set('/home/testuser/data', { type: 'directory', content: Buffer.alloc(0) });
  for (let i = 0; i < 40; i += 1) {
    tree.set(`/home/testuser/data/file-${i}.txt`, {
      type: 'file',
      content: Buffer.alloc(10 * 1024, `data-${i}`),
    });
  }
  tree.set('/home/testuser/data/nested', { type: 'directory', content: Buffer.alloc(0) });
  tree.set('/home/testuser/data/nested/inner.txt', {
    type: 'file',
    content: Buffer.alloc(10 * 1024, 'inner'),
  });
  return tree;
}

/** 将命令的大段 stdout 分块写入通道，模拟真实命令持续输出 */
function writeLinesInChunks(channel: ServerChannel, lines: string, done: () => void): void {
  const CHUNK = 64 * 1024;
  let offset = 0;
  while (offset < lines.length) {
    const chunk = lines.slice(offset, offset + CHUNK);
    offset += chunk.length;
    // 返回 false 表示通道发送窗口已满；剩余数据仍推入 ssh2 内部缓冲区，
    // 只有客户端消费 stdout 后窗口才会被释放，从而复现流控挂起
    channel.write(chunk);
  }
  done();
}

export class RealSshServer extends EventEmitter {
  private server: Server | null = null;
  private readonly options: Required<Omit<RealSshServerOptions, 'host' | 'port'>> & {
    host: string;
    port: number;
  };
  private readonly tree = buildDefaultTree();

  constructor(options: RealSshServerOptions = {}) {
    super();
    this.options = {
      host: options.host ?? '127.0.0.1',
      port: options.port ?? 0,
      username: options.username ?? 'testuser',
      password: options.password ?? 'testpass',
      hasUnzip: options.hasUnzip ?? true,
      unzipInflatingLines: options.unzipInflatingLines ?? 150_000,
      tarListLines: options.tarListLines ?? 150_000,
    };
  }

  get port(): number {
    return this.options.port;
  }

  async start(): Promise<number> {
    const { private: hostKey } = utils.generateKeyPairSync('ecdsa', {
      bits: 256,
      comment: 'integration test host key',
    });

    this.server = new Server({ hostKeys: [hostKey] }, (client) => {
      client.on('authentication', (ctx) => {
        if (
          ctx.method === 'password' &&
          ctx.username === this.options.username &&
          ctx.password === this.options.password
        ) {
          ctx.accept();
        } else {
          ctx.reject(['password']);
        }
      });

      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          if (!session) return;
          session.on('exec', (acceptExec, _rejectExec, info) => {
            const channel = acceptExec();
            if (channel) this.handleExec(channel, info.command);
          });
          session.on('sftp', (acceptSftp) => {
            const sftp = acceptSftp();
            if (sftp) this.bindSftp(sftp);
          });
        });
      });
    });

    await new Promise<void>((resolve, reject) => {
      const server = this.server;
      if (!server) {
        reject(new Error('SSH 服务器未初始化'));
        return;
      }
      server.once('error', reject);
      server.listen(this.options.port, this.options.host, () => resolve());
    });

    const address = this.server.address();
    if (typeof address === 'object' && address) {
      this.options.port = address.port;
    }
    return this.options.port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      const timer = setTimeout(() => resolve(), 500);
      timer.unref();
      this.server.close(() => {
        clearTimeout(timer);
        resolve();
      });
    });
  }

  /** 模拟远程命令：unzip/tar/which，用于解压链路复现 */
  private handleExec(channel: ServerChannel, command: string): void {
    if (/^command -v |^which /.test(command)) {
      if (/^cd .*&& (command -v|which) /.test(command)) {
        // 带 cd 前缀的命令按同样方式处理
      }
      const cmd = command.trim().split(/\s+/).pop() ?? '';
      const known = cmd === 'unzip' ? this.options.hasUnzip : cmd === 'tar' || cmd === 'zip';
      if (known) {
        channel.write(`/usr/bin/${cmd}\n`);
        channel.exit(0);
      } else {
        channel.exit(1);
      }
      channel.end();
      return;
    }

    if (/&?&? ?unzip -o/.test(command)) {
      const count = this.options.unzipInflatingLines;
      let body = '  Archive: archive.zip\n';
      for (let i = 0; i < count; i += 1) {
        body += `  inflating: data/file-${i}.txt\n`;
      }
      writeLinesInChunks(channel, body, () => {
        channel.exit(0);
        channel.end();
      });
      return;
    }

    if (/&?&? ?tar -x/.test(command)) {
      const count = this.options.tarListLines;
      let body = '';
      for (let i = 0; i < count; i += 1) {
        body += `data/file-${i}.txt\n`;
      }
      writeLinesInChunks(channel, body, () => {
        channel.exit(0);
        channel.end();
      });
      return;
    }

    // 其他命令（zip/tar 压缩等）：直接成功
    channel.exit(0);
    channel.end();
  }

  /**
   * 最小但真实协议的 SFTP 子系统：
   * 支持目录下载所需的 LSTAT/OPEN/READ/OPENDIR/READDIR/CLOSE/STAT。
   * 注意 READDIR 遵循 SFTP 协议：同一目录句柄第一次 READDIR 返回全部条目，
   * 再次 READDIR 返回 EOF，客户端据此结束遍历。
   */
  private bindSftp(sftp: SFTPStream): void {
    let handleCount = 0;
    const openFiles = new Map<number, { path: string }>();
    /** 目录句柄 -> { path, listingSent } */
    const openDirs = new Map<number, { path: string; listingSent: boolean }>();

    const attrsOf = (entry: TreeEntry) =>
      entry.type === 'directory'
        ? { mode: 0o40755, size: 4096, uid: 1000, gid: 1000, atime: 0, mtime: 0 }
        : {
            mode: 0o100644,
            size: entry.content.length,
            uid: 1000,
            gid: 1000,
            atime: 0,
            mtime: 0,
          };

    sftp.on('LSTAT', (reqid, path) => {
      const entry = this.tree.get(path);
      if (!entry) return sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      sftp.attrs(reqid, attrsOf(entry));
    });

    sftp.on('STAT', (reqid, path) => {
      const entry = this.tree.get(path);
      if (!entry) return sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      sftp.attrs(reqid, attrsOf(entry));
    });

    sftp.on('OPENDIR', (reqid, path) => {
      const entry = this.tree.get(path);
      if (!entry || entry.type !== 'directory') {
        return sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      }
      const handle = ++handleCount;
      openDirs.set(handle, { path, listingSent: false });
      sftp.handle(reqid, Buffer.from(String(handle)));
    });

    sftp.on('READDIR', (reqid, handle) => {
      const rec = openDirs.get(Number(handle));
      if (!rec) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      if (rec.listingSent) {
        // 目录内容已发完，按协议返回 EOF，客户端结束遍历
        return sftp.status(reqid, SFTP_STATUS_CODE.EOF);
      }
      rec.listingSent = true;
      const prefix = rec.path.endsWith('/') ? rec.path : `${rec.path}/`;
      const names: Array<{ filename: string; longname: string; attrs: object }> = [];
      for (const [path, entry] of this.tree.entries()) {
        if (!path.startsWith(prefix) || path === rec.path) continue;
        const rest = path.slice(prefix.length);
        if (rest.includes('/') || rest.length === 0) continue;
        names.push({
          filename: rest,
          longname: `${entry.type === 'directory' ? 'd' : '-'}rw-r--r-- 1 1000 1000 ${
            entry.content.length
          } ${rest}`,
          attrs: attrsOf(entry),
        });
      }
      sftp.name(reqid, names);
    });

    sftp.on('OPEN', (reqid, filename) => {
      const entry = this.tree.get(filename);
      if (!entry || entry.type !== 'file') {
        return sftp.status(reqid, SFTP_STATUS_CODE.NO_SUCH_FILE);
      }
      const handle = ++handleCount;
      openFiles.set(handle, { path: filename });
      sftp.handle(reqid, Buffer.from(String(handle)));
    });

    sftp.on('READ', (reqid, handle, offset, length) => {
      const rec = openFiles.get(Number(handle));
      if (!rec) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      const entry = this.tree.get(rec.path);
      if (!entry) return sftp.status(reqid, SFTP_STATUS_CODE.FAILURE);
      if (offset >= entry.content.length) {
        return sftp.status(reqid, SFTP_STATUS_CODE.EOF);
      }
      const end = Math.min(offset + length, entry.content.length);
      sftp.data(reqid, entry.content.subarray(offset, end));
    });

    sftp.on('CLOSE', (reqid, handle) => {
      openFiles.delete(Number(handle));
      openDirs.delete(Number(handle));
      sftp.status(reqid, SFTP_STATUS_CODE.OK);
    });
  }
}
