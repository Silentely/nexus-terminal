/**
 * 并发连接压力测试
 *
 * 测试系统在高并发场景下的稳定性，包括：
 * - WebSocket 并发连接数
 * - SSH 并发会话数
 * - SFTP 并发传输数
 * - 批量任务并发执行数
 */

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'events';
import { PERFORMANCE_THRESHOLDS } from './thresholds';
import WebSocket, { WebSocketServer } from 'ws';
import type { Server } from 'http';
import express from 'express';

/**
 * 模拟 WebSocket 服务器
 */
function createMockWebSocketServer(): { server: Server; wss: WebSocketServer; port: number } {
  const app = express();
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws) => {
    ws.on('message', (message) => {
      // 回显消息
      ws.send(message);
    });
  });

  return { server, wss, port };
}

/**
 * 模拟 SSH 连接池
 */
class MockSSHConnectionPool extends EventEmitter {
  private connections: Map<string, MockSSHConnection> = new Map();
  private maxConnections: number;

  constructor(maxConnections: number) {
    super();
    this.maxConnections = maxConnections;
  }

  async createConnection(id: string): Promise<MockSSHConnection> {
    if (this.connections.size >= this.maxConnections) {
      throw new Error(`连接数已达上限: ${this.maxConnections}`);
    }

    const connection = new MockSSHConnection(id);
    await connection.connect();
    this.connections.set(id, connection);
    this.emit('connection:created', id);

    return connection;
  }

  getConnection(id: string): MockSSHConnection | undefined {
    return this.connections.get(id);
  }

  async closeConnection(id: string): Promise<void> {
    const connection = this.connections.get(id);
    if (connection) {
      await connection.close();
      this.connections.delete(id);
      this.emit('connection:closed', id);
    }
  }

  async closeAll(): Promise<void> {
    const closePromises = Array.from(this.connections.keys()).map((id) => this.closeConnection(id));
    await Promise.all(closePromises);
  }

  getActiveConnectionCount(): number {
    return this.connections.size;
  }
}

/**
 * 模拟 SSH 连接
 */
class MockSSHConnection extends EventEmitter {
  private id: string;
  private connected = false;

  constructor(id: string) {
    super();
    this.id = id;
  }

  async connect(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 10)); // 模拟连接延迟
    this.connected = true;
    this.emit('ready');
  }

  async close(): Promise<void> {
    this.connected = false;
    this.removeAllListeners();
  }

  isConnected(): boolean {
    return this.connected;
  }

  getId(): string {
    return this.id;
  }
}

/**
 * 模拟 SFTP 传输任务
 */
class MockSFTPTransfer extends EventEmitter {
  private id: string;
  private progress = 0;
  private timer: NodeJS.Timeout | null = null;

  constructor(id: string) {
    super();
    this.id = id;
  }

  start(): void {
    this.timer = setInterval(() => {
      this.progress += 10;
      this.emit('progress', this.progress);

      if (this.progress >= 100) {
        this.complete();
      }
    }, 50);
  }

  private complete(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('complete');
  }

  abort(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.emit('abort');
  }

  getProgress(): number {
    return this.progress;
  }
}

describe('Concurrent Connections Stress Tests', () => {
  it(`应该支持 ${PERFORMANCE_THRESHOLDS.concurrent.websocketConnections} 个并发 WebSocket 连接`, async () => {
    const { server, wss, port } = createMockWebSocketServer();
    const clients: WebSocket[] = [];

    try {
      // 创建并发连接
      const connectionPromises = Array.from({
        length: PERFORMANCE_THRESHOLDS.concurrent.websocketConnections,
      }).map(
        () =>
          new Promise<WebSocket>((resolve, reject) => {
            const ws = new WebSocket(`ws://localhost:${port}`);
            ws.on('open', () => resolve(ws));
            ws.on('error', reject);
            clients.push(ws);
          }),
      );

      await Promise.all(connectionPromises);

      console.log(`成功建立 ${clients.length} 个 WebSocket 连接`);

      // 验证所有连接可用
      const messagePromises = clients.map(
        (ws, i) =>
          new Promise<void>((resolve) => {
            ws.once('message', (data) => {
              expect(data.toString()).toBe(`test-${i}`);
              resolve();
            });
            ws.send(`test-${i}`);
          }),
      );

      await Promise.all(messagePromises);

      expect(wss.clients.size).toBe(PERFORMANCE_THRESHOLDS.concurrent.websocketConnections);
    } finally {
      // 清理连接
      clients.forEach((ws) => ws.close());
      wss.close();
      server.close();
    }
  }, 30000);

  it(`应该支持 ${PERFORMANCE_THRESHOLDS.concurrent.sshConnections} 个并发 SSH 连接`, async () => {
    const pool = new MockSSHConnectionPool(PERFORMANCE_THRESHOLDS.concurrent.sshConnections);

    try {
      const startTime = Date.now();

      // 并发创建连接
      const connectionPromises = Array.from({
        length: PERFORMANCE_THRESHOLDS.concurrent.sshConnections,
      }).map((_, i) => pool.createConnection(`ssh-${i}`));

      const connections = await Promise.all(connectionPromises);
      const createTime = Date.now() - startTime;

      console.log(`成功创建 ${connections.length} 个 SSH 连接，耗时 ${createTime}ms`);
      console.log(`平均每个连接创建耗时: ${(createTime / connections.length).toFixed(2)}ms`);

      // 验证所有连接都处于活跃状态
      expect(pool.getActiveConnectionCount()).toBe(
        PERFORMANCE_THRESHOLDS.concurrent.sshConnections,
      );
      connections.forEach((conn) => {
        expect(conn.isConnected()).toBe(true);
      });

      // 测试超出限制的连接应该失败
      await expect(pool.createConnection('overflow')).rejects.toThrow('连接数已达上限');
    } finally {
      await pool.closeAll();
    }
  }, 30000);

  it(`应该支持 ${PERFORMANCE_THRESHOLDS.concurrent.sftpTransfers} 个并发 SFTP 传输`, async () => {
    const transfers: MockSFTPTransfer[] = [];
    const completionPromises: Promise<void>[] = [];

    // 创建并发传输任务
    for (let i = 0; i < PERFORMANCE_THRESHOLDS.concurrent.sftpTransfers; i++) {
      const transfer = new MockSFTPTransfer(`transfer-${i}`);
      transfers.push(transfer);

      const promise = new Promise<void>((resolve) => {
        transfer.on('complete', resolve);
      });
      completionPromises.push(promise);

      transfer.start();
    }

    const startTime = Date.now();
    await Promise.all(completionPromises);
    const totalTime = Date.now() - startTime;

    console.log(
      `${PERFORMANCE_THRESHOLDS.concurrent.sftpTransfers} 个并发传输任务完成，总耗时 ${totalTime}ms`,
    );

    // 验证所有任务都完成
    transfers.forEach((transfer) => {
      expect(transfer.getProgress()).toBe(100);
    });

    // 清理
    transfers.forEach((transfer) => transfer.abort());
  }, 15000);

  it(`应该支持 ${PERFORMANCE_THRESHOLDS.concurrent.batchSubtasks} 个并发批量子任务`, async () => {
    const subtasks: Promise<void>[] = [];

    // 模拟批量子任务并发执行
    for (let i = 0; i < PERFORMANCE_THRESHOLDS.concurrent.batchSubtasks; i++) {
      const task = new Promise<void>((resolve) => {
        // 模拟任务执行时间（50-150ms 随机）
        const executionTime = 50 + Math.random() * 100;
        setTimeout(resolve, executionTime);
      });
      subtasks.push(task);
    }

    const startTime = Date.now();
    await Promise.all(subtasks);
    const totalTime = Date.now() - startTime;

    console.log(
      `${PERFORMANCE_THRESHOLDS.concurrent.batchSubtasks} 个并发子任务完成，总耗时 ${totalTime}ms`,
    );

    // 并发执行应该比串行快很多（串行至少需要 50 * 20 = 1000ms）
    expect(totalTime).toBeLessThan(500);
  }, 10000);

  it('压力测试：混合负载（SSH + WebSocket + SFTP）', async () => {
    const { server, wss, port } = createMockWebSocketServer();
    const sshPool = new MockSSHConnectionPool(PERFORMANCE_THRESHOLDS.concurrent.sshConnections);
    const wsClients: WebSocket[] = [];
    const sftpTransfers: MockSFTPTransfer[] = [];

    try {
      const startTime = Date.now();

      // 同时创建多种类型的连接
      await Promise.all([
        // 创建 20 个 SSH 连接
        ...Array.from({ length: 20 }).map((_unused, i) => sshPool.createConnection(`ssh-${i}`)),

        // 创建 30 个 WebSocket 连接
        ...Array.from({ length: 30 }).map(
          () =>
            new Promise<WebSocket>((resolve, reject) => {
              const ws = new WebSocket(`ws://localhost:${port}`);
              ws.on('open', () => resolve(ws));
              ws.on('error', reject);
              wsClients.push(ws);
            }),
        ),
      ]);

      // 启动 5 个 SFTP 传输
      const transferPromises = Array.from({ length: 5 }).map((_, i) => {
        const transfer = new MockSFTPTransfer(`transfer-${i}`);
        sftpTransfers.push(transfer);
        return new Promise<void>((resolve) => {
          transfer.on('complete', resolve);
          transfer.start();
        });
      });

      await Promise.all(transferPromises);

      const totalTime = Date.now() - startTime;

      console.log(`混合负载测试完成，总耗时 ${totalTime}ms:
        - SSH 连接: ${sshPool.getActiveConnectionCount()}
        - WebSocket 连接: ${wss.clients.size}
        - SFTP 传输: ${sftpTransfers.length}
      `);

      expect(sshPool.getActiveConnectionCount()).toBe(20);
      expect(wss.clients.size).toBe(30);
      expect(sftpTransfers.every((t) => t.getProgress() === 100)).toBe(true);
    } finally {
      // 清理所有资源
      await sshPool.closeAll();
      wsClients.forEach((ws) => ws.close());
      sftpTransfers.forEach((t) => t.abort());
      wss.close();
      server.close();
    }
  }, 30000);
});
