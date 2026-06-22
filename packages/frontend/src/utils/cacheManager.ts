/**
 * 统一的本地缓存管理器
 * 提供类型安全的 localStorage 操作，支持版本控制和过期管理
 */
import { log } from '@/utils/log';

// 缓存键前缀，避免与其他应用冲突
const CACHE_PREFIX = 'nexus_';

// 默认缓存版本
const DEFAULT_VERSION = 1;

/**
 * 缓存数据包装结构
 */
interface CachedData<T> {
  version: number;
  timestamp: number;
  data: T;
}

/**
 * 缓存配置选项
 */
export interface CacheOptions {
  /** 缓存版本号，版本不匹配时自动清除缓存 */
  version?: number;
  /** 缓存有效期（毫秒），0 或不设置表示永不过期 */
  ttl?: number;
}

/**
 * 统一的缓存管理器
 * 提供类型安全的 get/set/remove/clear 操作
 */
export class CacheManager {
  private prefix: string;

  constructor(prefix: string = CACHE_PREFIX) {
    this.prefix = prefix;
  }

  /**
   * 构建完整的缓存键
   */
  private buildKey(key: string): string {
    return `${this.prefix}${key}`;
  }

  /**
   * 获取缓存数据
   * @param key 缓存键
   * @param defaultValue 默认值（缓存不存在或无效时返回）
   * @param options 缓存选项
   */
  get<T>(key: string, defaultValue: T, options: CacheOptions = {}): T {
    const { version = DEFAULT_VERSION, ttl = 0 } = options;
    const fullKey = this.buildKey(key);

    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) {
        return defaultValue;
      }

      const cached = JSON.parse(raw) as CachedData<T>;

      // 版本检查
      if (cached.version !== version) {
        log.debug(
          `[CacheManager] 缓存版本不匹配: ${key} (期望: ${version}, 实际: ${cached.version})`,
        );
        this.remove(key);
        return defaultValue;
      }

      // TTL 检查
      if (ttl > 0 && Date.now() - cached.timestamp > ttl) {
        log.debug(`[CacheManager] 缓存已过期: ${key}`);
        this.remove(key);
        return defaultValue;
      }

      return cached.data;
    } catch (error: unknown) {
      log.error(`[CacheManager] 读取缓存失败: ${key}`, error);
      this.remove(key);
      return defaultValue;
    }
  }

  /**
   * 设置缓存数据
   * @param key 缓存键
   * @param value 缓存值
   * @param options 缓存选项
   */
  set<T>(key: string, value: T, options: CacheOptions = {}): boolean {
    const { version = DEFAULT_VERSION } = options;
    const fullKey = this.buildKey(key);

    try {
      const cached: CachedData<T> = {
        version,
        timestamp: Date.now(),
        data: value,
      };
      localStorage.setItem(fullKey, JSON.stringify(cached));
      return true;
    } catch (error: unknown) {
      log.error(`[CacheManager] 写入缓存失败: ${key}`, error);
      // 可能是存储空间不足，尝试清理过期缓存
      this.clearExpired();
      return false;
    }
  }

  /**
   * 移除指定缓存
   * @param key 缓存键
   */
  remove(key: string): void {
    const fullKey = this.buildKey(key);
    localStorage.removeItem(fullKey);
  }

  /**
   * 检查缓存是否存在且有效
   * @param key 缓存键
   * @param options 缓存选项
   */
  has(key: string, options: CacheOptions = {}): boolean {
    const { version = DEFAULT_VERSION, ttl = 0 } = options;
    const fullKey = this.buildKey(key);

    try {
      const raw = localStorage.getItem(fullKey);
      if (!raw) return false;

      const cached = JSON.parse(raw) as CachedData<unknown>;

      if (cached.version !== version) return false;
      if (ttl > 0 && Date.now() - cached.timestamp > ttl) return false;

      return true;
    } catch {
      return false;
    }
  }

  /**
   * 清除所有带前缀的缓存
   */
  clear(): void {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((key) => localStorage.removeItem(key));
    log.debug(`[CacheManager] 已清除 ${keysToRemove.length} 个缓存项`);
  }

  /**
   * 清除所有过期缓存（需要知道各缓存的 TTL）
   * 注意：此方法会遍历所有缓存，仅清除明确过期的项
   */
  clearExpired(): void {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        try {
          const raw = localStorage.getItem(key);
          if (raw) {
            const cached = JSON.parse(raw) as CachedData<unknown>;
            // 清除超过 30 天的缓存（作为安全兜底）
            const maxAge = 30 * 24 * 60 * 60 * 1000;
            if (now - cached.timestamp > maxAge) {
              keysToRemove.push(key);
            }
          }
        } catch {
          // 解析失败的也清除
          keysToRemove.push(key);
        }
      }
    }

    keysToRemove.forEach((key) => localStorage.removeItem(key));
    if (keysToRemove.length > 0) {
      log.debug(`[CacheManager] 已清除 ${keysToRemove.length} 个过期/无效缓存项`);
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { count: number; totalSize: number; keys: string[] } {
    const keys: string[] = [];
    let totalSize = 0;

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keys.push(key.replace(this.prefix, ''));
        const value = localStorage.getItem(key);
        if (value) {
          totalSize += value.length * 2; // UTF-16 编码，每字符 2 字节
        }
      }
    }

    return {
      count: keys.length,
      totalSize,
      keys,
    };
  }
}

// 导出默认实例
export const cacheManager = new CacheManager();

// 导出缓存键常量
export const CACHE_KEYS = {
  CONNECTIONS: 'connections',
  TAGS: 'tags',
  PROXIES: 'proxies',
  QUICK_COMMANDS: 'quickCommands',
  SETTINGS: 'settings',
  APPEARANCE: 'appearance',
  LAYOUT: 'layout',
  SIDEBAR: 'sidebar',
} as const;

// 导出缓存配置
export const CACHE_CONFIG = {
  [CACHE_KEYS.CONNECTIONS]: { version: 1, ttl: 5 * 60 * 1000 }, // 5 分钟
  [CACHE_KEYS.TAGS]: { version: 1, ttl: 10 * 60 * 1000 }, // 10 分钟
  [CACHE_KEYS.PROXIES]: { version: 1, ttl: 10 * 60 * 1000 }, // 10 分钟
  [CACHE_KEYS.QUICK_COMMANDS]: { version: 1, ttl: 10 * 60 * 1000 }, // 10 分钟
  [CACHE_KEYS.SETTINGS]: { version: 1, ttl: 0 }, // 永不过期
  [CACHE_KEYS.APPEARANCE]: { version: 1, ttl: 0 }, // 永不过期
  [CACHE_KEYS.LAYOUT]: { version: 1, ttl: 0 }, // 永不过期
  [CACHE_KEYS.SIDEBAR]: { version: 1, ttl: 0 }, // 永不过期
} as const;
