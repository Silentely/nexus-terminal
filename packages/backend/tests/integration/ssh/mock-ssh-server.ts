import { EventEmitter } from 'events';
import { Server as NetServer, Socket } from 'net';
// eslint-disable-next-line import/no-extraneous-dependencies
import { vi } from 'vitest';

/**
 * Mock SSH 服务器 - 用于集成测试
 */
export interface MockSshServerOptions {
  host?: string;
  port?: number;
  username?: string;
  password?: string;
  hostKey?: string;
  banner?: string;
}

export interface MockSftpStats {
  mode: number;
  uid: number;
  gid: number;
  size: number;
  atime: number;
  mtime: number;
}

export interface MockSftpEntry {
  filename: string;
  longname: string;
  attrs: MockSftpStats;
}

/**
 * Mock SSH 连接类
 */
export class MockSshConnection extends EventEmitter {
  private _authenticated = false;
  private _shellOpened = false;

  constructor(
    private readonly socket: Socket,
    private readonly options: MockSshServerOptions
  ) {
    super();
    this.setupHandlers();
  }

  private setupHandlers() {
    // 模拟 SSH 握手完成
    setTimeout(() => {
      this.emit('ready');
    }, 50);
  }

  authenticate(method: string, username: string, password?: string): boolean {
    if (method === 'password') {
      this._authenticated =
        username === (this.options.username || 'testuser') &&
        password === (this.options.password || 'testpass');
    }
    return this._authenticated;
  }

  openShell(callback: (err: Error | null, stream: MockShellStream) => void): void {
    if (!this._authenticated) {
      callback(new Error('Not authenticated'), null as any);
      return;
    }
    this._shellOpened = true;
    const stream = new MockShellStream();
    setTimeout(() => callback(null, stream), 10);
  }

  openSftp(callback: (err: Error | null, sftp: MockSftpSession) => void): void {
    if (!this._authenticated) {
      callback(new Error('Not authenticated'), null as any);
      return;
    }
    const sftp = new MockSftpSession();
    setTimeout(() => callback(null, sftp), 10);
  }

  end(): void {
    this.socket.end();
    this.emit('end');
  }
}

/**
 * Mock Shell 流
 */
export class MockShellStream extends EventEmitter {
  private _buffer: string[] = [];

  write(data: string | Buffer): boolean {
    const str = typeof data === 'string' ? data : data.toString();
    this._buffer.push(str);

    // 模拟命令响应
    if (str.includes('\n') || str.includes('\r')) {
      const command = this._buffer.join('').trim();
      this._buffer = [];
      this.simulateResponse(command);
    }
    return true;
  }

  private simulateResponse(command: string): void {
    let response = '';

    if (command.startsWith('echo ')) {
      response = `${command.substring(5)}\n`;
    } else if (command === 'whoami') {
      response = 'testuser\n';
    } else if (command === 'pwd') {
      response = '/home/testuser\n';
    } else if (command === 'ls') {
      response = 'file1.txt\nfile2.txt\ndir1\n';
    } else if (command === 'exit') {
      this.emit('close');
      return;
    } else {
      response = `${command}: command executed\n`;
    }

    setTimeout(() => {
      this.emit('data', Buffer.from(response));
    }, 10);
  }

  end(): void {
    this.emit('close');
  }

  destroy(): void {
    this.emit('close');
  }
}

/**
 * Mock SFTP 会话
 */
export class MockSftpSession extends EventEmitter {
  private _filesystem: Map<
    string,
    { type: 'file' | 'directory'; content?: Buffer; stats: MockSftpStats }
  > = new Map();

  constructor() {
    super();
    this.initializeFilesystem();
  }

  private initializeFilesystem(): void {
    const now = Date.now() / 1000;

    // 初始化模拟文件系统
    this._filesystem.set('/home/testuser', {
      type: 'directory',
      stats: { mode: 0o755, uid: 1000, gid: 1000, size: 4096, atime: now, mtime: now },
    });
    this._filesystem.set('/home/testuser/test.txt', {
      type: 'file',
      content: Buffer.from('Test file content'),
      stats: { mode: 0o644, uid: 1000, gid: 1000, size: 17, atime: now, mtime: now },
    });
    this._filesystem.set('/home/testuser/subdir', {
      type: 'directory',
      stats: { mode: 0o755, uid: 1000, gid: 1000, size: 4096, atime: now, mtime: now },
    });
  }

  readdir(path: string, callback: (err: Error | null, entries?: MockSftpEntry[]) => void): void {
    const entries: MockSftpEntry[] = [];
    const prefix = path.endsWith('/') ? path : `${path}/`;

    for (const [filePath, data] of this._filesystem.entries()) {
      if (filePath.startsWith(prefix) && filePath !== path) {
        const relativePath = filePath.substring(prefix.length);
        if (!relativePath.includes('/')) {
          entries.push({
            filename: relativePath,
            longname: `${data.type === 'directory' ? 'd' : '-'}rwxr-xr-x 1 testuser testuser ${data.stats.size} Jan 1 00:00 ${relativePath}`,
            attrs: data.stats,
          });
        }
      }
    }

    setTimeout(() => callback(null, entries), 5);
  }

  stat(path: string, callback: (err: Error | null, stats?: MockSftpStats) => void): void {
    const entry = this._filesystem.get(path);
    if (entry) {
      setTimeout(() => callback(null, entry.stats), 5);
    } else {
      setTimeout(() => callback(new Error('ENOENT: no such file or directory')), 5);
    }
  }

  open(path: string, flags: string, callback: (err: Error | null, handle?: Buffer) => void): void {
    const handle = Buffer.from(path);
    setTimeout(() => callback(null, handle), 5);
  }

  read(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null, bytesRead?: number) => void
  ): void {
    const path = handle.toString();
    const entry = this._filesystem.get(path);

    if (entry && entry.type === 'file' && entry.content) {
      const content = entry.content;
      const bytesToRead = Math.min(length, content.length - position);
      if (bytesToRead > 0) {
        content.copy(buffer, offset, position, position + bytesToRead);
      }
      setTimeout(() => callback(null, bytesToRead), 5);
    } else {
      setTimeout(() => callback(new Error('Invalid handle or not a file')), 5);
    }
  }

  write(
    handle: Buffer,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
    callback: (err: Error | null) => void
  ): void {
    const path = handle.toString();
    let entry = this._filesystem.get(path);

    if (!entry) {
      const now = Date.now() / 1000;
      entry = {
        type: 'file',
        content: Buffer.alloc(0),
        stats: { mode: 0o644, uid: 1000, gid: 1000, size: 0, atime: now, mtime: now },
      };
      this._filesystem.set(path, entry);
    }

    if (entry.type === 'file') {
      const newContent = Buffer.alloc(Math.max(entry.content?.length || 0, position + length));
      if (entry.content) {
        entry.content.copy(newContent, 0);
      }
      buffer.copy(newContent, position, offset, offset + length);
      entry.content = newContent;
      entry.stats.size = newContent.length;
      entry.stats.mtime = Date.now() / 1000;
    }

    setTimeout(() => callback(null), 5);
  }

  close(handle: Buffer, callback: (err: Error | null) => void): void {
    setTimeout(() => callback(null), 5);
  }

  mkdir(path: string, callback: (err: Error | null) => void): void {
    if (this._filesystem.has(path)) {
      setTimeout(() => callback(new Error('EEXIST: file already exists')), 5);
      return;
    }
    const now = Date.now() / 1000;
    this._filesystem.set(path, {
      type: 'directory',
      stats: { mode: 0o755, uid: 1000, gid: 1000, size: 4096, atime: now, mtime: now },
    });
    setTimeout(() => callback(null), 5);
  }

  rmdir(path: string, callback: (err: Error | null) => void): void {
    if (!this._filesystem.has(path)) {
      setTimeout(() => callback(new Error('ENOENT: no such file or directory')), 5);
      return;
    }
    this._filesystem.delete(path);
    setTimeout(() => callback(null), 5);
  }

  unlink(path: string, callback: (err: Error | null) => void): void {
    if (!this._filesystem.has(path)) {
      setTimeout(() => callback(new Error('ENOENT: no such file or directory')), 5);
      return;
    }
    this._filesystem.delete(path);
    setTimeout(() => callback(null), 5);
  }

  rename(oldPath: string, newPath: string, callback: (err: Error | null) => void): void {
    const entry = this._filesystem.get(oldPath);
    if (!entry) {
      setTimeout(() => callback(new Error('ENOENT: no such file or directory')), 5);
      return;
    }
    this._filesystem.delete(oldPath);
    this._filesystem.set(newPath, entry);
    setTimeout(() => callback(null), 5);
  }

  end(): void {
    this.emit('end');
  }
}

/**
 * Mock SSH 服务器
 */
export class MockSshServer extends EventEmitter {
  private _server: NetServer | null = null;
  private _connections: MockSshConnection[] = [];
  private readonly _options: MockSshServerOptions;

  constructor(options: MockSshServerOptions = {}) {
    super();
    this._options = {
      host: options.host || '127.0.0.1',
      port: options.port || 0, // 0 = 随机端口
      username: options.username || 'testuser',
      password: options.password || 'testpass',
      banner: options.banner || 'Mock SSH Server',
    };
  }

  get address(): { host: string; port: number } | null {
    if (!this._server) return null;
    const addr = this._server.address();
    if (typeof addr === 'string') return null;
    return { host: this._options.host!, port: addr?.port || 0 };
  }

  async start(): Promise<{ host: string; port: number }> {
    return new Promise((resolve, reject) => {
      this._server = new NetServer((socket) => {
        const connection = new MockSshConnection(socket, this._options);
        this._connections.push(connection);
        this.emit('connection', connection);

        socket.on('close', () => {
          const index = this._connections.indexOf(connection);
          if (index > -1) {
            this._connections.splice(index, 1);
          }
        });
      });

      this._server.on('error', reject);

      this._server.listen(this._options.port, this._options.host, () => {
        const addr = this.address;
        if (addr) {
          resolve(addr);
        } else {
          reject(new Error('Failed to get server address'));
        }
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      // 关闭所有连接
      for (const conn of this._connections) {
        conn.end();
      }
      this._connections = [];

      if (this._server) {
        this._server.close(() => {
          this._server = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }
}

/**
 * 创建 Mock SSH 客户端（用于替换 ssh2.Client）
 */
export function createMockSshClient(serverAddress: { host: string; port: number }) {
  const client = new EventEmitter() as EventEmitter & {
    connect: ReturnType<typeof vi.fn>;
    shell: ReturnType<typeof vi.fn>;
    sftp: ReturnType<typeof vi.fn>;
    end: ReturnType<typeof vi.fn>;
    _mockConnection: MockSshConnection | null;
  };

  client._mockConnection = null;

  client.connect = vi.fn().mockImplementation((config: any) => {
    // 模拟连接过程
    setTimeout(() => {
      client.emit('ready');
    }, 50);
    return client;
  });

  client.shell = vi
    .fn()
    .mockImplementation((callback: (err: Error | null, stream: MockShellStream) => void) => {
      const stream = new MockShellStream();
      setTimeout(() => callback(null, stream), 10);
    });

  client.sftp = vi
    .fn()
    .mockImplementation((callback: (err: Error | null, sftp: MockSftpSession) => void) => {
      const sftp = new MockSftpSession();
      setTimeout(() => callback(null, sftp), 10);
    });

  client.end = vi.fn().mockImplementation(() => {
    client.emit('end');
  });

  return client;
}
