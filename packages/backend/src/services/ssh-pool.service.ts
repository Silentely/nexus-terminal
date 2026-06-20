/**
 * SSH 连接池服务
 * 为批量任务提供连接复用，减少重复建立连接的开销
 */
import { Client } from 'ssh2';
import { logger } from '../utils/logger';

interface PooledConnection {
  client: Client;
  createdAt: number;
  lastUsedAt: number;
  inUse: boolean;
}

export interface PoolKey {
  host: string;
  port: number;
  username: string;
  authMethod: string;
  proxyId: number | null;
}

export class SshPoolService {
  private pools = new Map<string, PooledConnection[]>();
  private readonly maxPerTarget = 3;
  private readonly idleTimeoutMs = 60 * 1000; // 60 秒
  private readonly cleanupIntervalMs = 30 * 1000; // 30 秒
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // 定期清理空闲连接
    this.cleanupTimer = setInterval(() => this.cleanupIdleConnections(), this.cleanupIntervalMs);
  }

  /**
   * 生成连接池键
   */
  private getPoolKey(key: PoolKey): string {
    return `${key.host}:${key.port}:${key.username}:${key.authMethod}:${key.proxyId ?? 'none'}`;
  }

  /**
   * 从池中获取连接
   * @returns 空闲连接，如果需要创建新连接则返回 null
   */
  acquire(key: PoolKey): Client | null {
    const poolKey = this.getPoolKey(key);
    const pool = this.pools.get(poolKey) ?? [];

    // 查找空闲连接
    const idle = pool.find((c) => !c.inUse);
    if (idle) {
      idle.inUse = true;
      idle.lastUsedAt = Date.now();
      logger.debug(`[SshPool] 复用连接: ${poolKey}`);
      return idle.client;
    }

    // 池未满，返回 null 表示需要创建新连接
    if (pool.length < this.maxPerTarget) {
      return null;
    }

    // 池已满且无空闲连接
    logger.debug(`[SshPool] 连接池已满: ${poolKey}`);
    return null;
  }

  /**
   * 将新创建的连接添加到池中
   * 注意：新添加的连接默认为 inUse 状态，因为调用者会立即使用它
   */
  add(key: PoolKey, client: Client): boolean {
    const poolKey = this.getPoolKey(key);
    const pool = this.pools.get(poolKey) ?? [];

    // 检查是否已达到上限
    if (pool.length >= this.maxPerTarget) {
      logger.debug(`[SshPool] 连接池已满，拒绝添加: ${poolKey}`);
      return false;
    }

    pool.push({
      client,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      inUse: true, // 新连接立即被使用，标记为 inUse
    });

    this.pools.set(poolKey, pool);

    // 监听连接关闭/错误事件，自动从池中移除
    client.on('close', () => {
      this.removeFromPool(poolKey, client);
    });
    client.on('error', () => {
      this.removeFromPool(poolKey, client);
    });

    logger.debug(`[SshPool] 添加连接到池: ${poolKey}，当前池大小: ${pool.length}`);
    return true;
  }

  /**
   * 从池中移除连接（内部方法）
   */
  private removeFromPool(poolKey: string, client: Client): void {
    const pool = this.pools.get(poolKey);
    if (!pool) return;

    const index = pool.findIndex((c) => c.client === client);
    if (index !== -1) {
      pool.splice(index, 1);
      logger.debug(`[SshPool] 连接已从池中移除: ${poolKey}`);
    }
    if (pool.length === 0) {
      this.pools.delete(poolKey);
    }
  }

  /**
   * 归还连接到池中
   */
  release(key: PoolKey, client: Client): void {
    const poolKey = this.getPoolKey(key);
    const pool = this.pools.get(poolKey) ?? [];

    const pooled = pool.find((c) => c.client === client);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsedAt = Date.now();
      logger.debug(`[SshPool] 归还连接: ${poolKey}`);
    }
  }

  /**
   * 丢弃连接（连接异常或取消时调用）
   */
  discard(key: PoolKey, client: Client): void {
    const poolKey = this.getPoolKey(key);
    const pool = this.pools.get(poolKey) ?? [];
    const index = pool.findIndex((c) => c.client === client);
    if (index !== -1) {
      pool.splice(index, 1);
      try {
        client.end();
      } catch (err) {
        logger.debug(`[SshPool] 关闭连接时出错: ${poolKey}`, err);
      }
      logger.debug(`[SshPool] 丢弃连接: ${poolKey}`);
    }
  }

  /**
   * 清理空闲连接
   */
  private cleanupIdleConnections(): void {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [poolKey, pool] of this.pools) {
      for (let i = pool.length - 1; i >= 0; i--) {
        const conn = pool[i];
        if (!conn.inUse && now - conn.lastUsedAt > this.idleTimeoutMs) {
          try {
            conn.client.end();
          } catch (err) {
            logger.debug(`[SshPool] 关闭空闲连接时出错: ${poolKey}`, err);
          }
          pool.splice(i, 1);
          cleanedCount++;
          logger.debug(`[SshPool] 回收空闲连接: ${poolKey}`);
        }
      }
      if (pool.length === 0) {
        this.pools.delete(poolKey);
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`[SshPool] 清理了 ${cleanedCount} 个空闲连接`);
    }
  }

  /**
   * 获取池统计信息
   */
  getStats(): { totalConnections: number; activeConnections: number; idleConnections: number } {
    let totalConnections = 0;
    let activeConnections = 0;
    let idleConnections = 0;

    for (const pool of this.pools.values()) {
      totalConnections += pool.length;
      activeConnections += pool.filter((c) => c.inUse).length;
      idleConnections += pool.filter((c) => !c.inUse).length;
    }

    return { totalConnections, activeConnections, idleConnections };
  }

  /**
   * 关闭所有连接并停止清理定时器
   */
  shutdown(): void {
    // 停止清理定时器
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }

    // 关闭所有连接
    for (const pool of this.pools.values()) {
      for (const conn of pool) {
        try {
          conn.client.end();
        } catch (err: unknown) {
          logger.debug({ err }, '操作失败，已忽略');
          // 忽略关闭错误
        }
      }
    }
    this.pools.clear();
    logger.debug('[SshPool] 连接池已关闭');
  }
}

// 单例导出
export const sshPoolService = new SshPoolService();
