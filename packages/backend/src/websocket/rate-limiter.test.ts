/**
 * WebSocket 消息速率限制器单元测试
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { checkRateLimit, cleanupRateLimit, getRateLimitStatus } from './rate-limiter';

describe('WebSocket 速率限制器', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // 清理所有会话状态，确保测试隔离
    cleanupRateLimit('session-1');
    cleanupRateLimit('session-2');
    cleanupRateLimit('non-existent');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkRateLimit', () => {
    it('窗口内允许消息通过', () => {
      const result = checkRateLimit('session-1', 'ssh:input');
      expect(result).toBe(true);
    });

    it('窗口内允许最多 maxMessages 条消息', () => {
      // ssh:input 限制 100 条/秒
      for (let i = 0; i < 100; i++) {
        expect(checkRateLimit('session-1', 'ssh:input')).toBe(true);
      }
    });

    it('超过限制时返回 false', () => {
      // ssh:input 限制 100 条/秒
      for (let i = 0; i < 100; i++) {
        checkRateLimit('session-1', 'ssh:input');
      }
      // 第 101 条应被拒绝
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(false);
    });

    it('窗口重置后允许消息通过', () => {
      // ssh:input 限制 100 条/秒
      for (let i = 0; i < 100; i++) {
        checkRateLimit('session-1', 'ssh:input');
      }
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(false);

      // 前进 1 秒，窗口重置
      vi.advanceTimersByTime(1001);
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(true);
    });

    it('不同会话独立限制', () => {
      // ssh:input 限制 100 条/秒
      for (let i = 0; i < 100; i++) {
        checkRateLimit('session-1', 'ssh:input');
      }
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(false);
      // 不同会话应独立
      expect(checkRateLimit('session-2', 'ssh:input')).toBe(true);
    });

    it('不同消息类型独立限制', () => {
      // ssh:input 限制 100 条/秒，sftp:readdir 限制 20 条/秒
      for (let i = 0; i < 100; i++) {
        checkRateLimit('session-1', 'ssh:input');
      }
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(false);
      // sftp:readdir 应独立限制
      expect(checkRateLimit('session-1', 'sftp:readdir')).toBe(true);
    });

    it('未配置的消息类型使用默认限制（50/秒）', () => {
      for (let i = 0; i < 50; i++) {
        expect(checkRateLimit('session-1', 'unknown:type')).toBe(true);
      }
      expect(checkRateLimit('session-1', 'unknown:type')).toBe(false);
    });

    it('SFTP 操作限制 20 条/秒', () => {
      for (let i = 0; i < 20; i++) {
        expect(checkRateLimit('session-1', 'sftp:readdir')).toBe(true);
      }
      expect(checkRateLimit('session-1', 'sftp:readdir')).toBe(false);
    });

    it('Docker 操作限制 5 条/秒', () => {
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit('session-1', 'docker:get_status')).toBe(true);
      }
      expect(checkRateLimit('session-1', 'docker:get_status')).toBe(false);
    });

    it('批量操作限制 5 条/秒', () => {
      for (let i = 0; i < 5; i++) {
        expect(checkRateLimit('session-1', 'batch:create')).toBe(true);
      }
      expect(checkRateLimit('session-1', 'batch:create')).toBe(false);
    });

    it('多文件上传启动仍保留普通消息限流并在窗口重置后恢复', () => {
      for (let i = 0; i < 100; i++) {
        expect(checkRateLimit('session-1', 'sftp:upload:start')).toBe(true);
      }
      expect(checkRateLimit('session-1', 'sftp:upload:start')).toBe(false);

      vi.advanceTimersByTime(1001);
      expect(checkRateLimit('session-1', 'sftp:upload:start')).toBe(true);
    });

    it('上传分块交给 SFTP 上传管理器控制，不受普通消息频率误伤', () => {
      for (let i = 0; i < 5000; i++) {
        expect(checkRateLimit('session-1', 'sftp:upload:chunk')).toBe(true);
      }

      expect(getRateLimitStatus('session-1')['sftp:upload:chunk']).toBeUndefined();
    });
  });

  describe('cleanupRateLimit', () => {
    it('清理后会话状态被删除', () => {
      checkRateLimit('session-1', 'ssh:input');
      cleanupRateLimit('session-1');

      // 清理后应重新开始计数
      const status = getRateLimitStatus('session-1');
      expect(Object.keys(status)).toHaveLength(0);
    });

    it('清理后重新允许消息通过', () => {
      for (let i = 0; i < 100; i++) {
        checkRateLimit('session-1', 'ssh:input');
      }
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(false);

      cleanupRateLimit('session-1');
      expect(checkRateLimit('session-1', 'ssh:input')).toBe(true);
    });

    it('清理不存在的会话不报错', () => {
      expect(() => cleanupRateLimit('non-existent')).not.toThrow();
    });
  });

  describe('getRateLimitStatus', () => {
    it('返回空对象对于未注册的会话', () => {
      const status = getRateLimitStatus('non-existent');
      expect(Object.keys(status)).toHaveLength(0);
    });

    it('返回正确的消息类型状态', () => {
      checkRateLimit('session-1', 'ssh:input');
      checkRateLimit('session-1', 'ssh:input');
      checkRateLimit('session-1', 'sftp:readdir');

      const status = getRateLimitStatus('session-1');
      expect(status['ssh:input']).toEqual({ count: 2, limit: 100 });
      expect(status['sftp:readdir']).toEqual({ count: 1, limit: 20 });
    });

    it('窗口重置后计数归零', () => {
      for (let i = 0; i < 50; i++) {
        checkRateLimit('session-1', 'ssh:input');
      }

      vi.advanceTimersByTime(1001);
      checkRateLimit('session-1', 'ssh:input');

      const status = getRateLimitStatus('session-1');
      expect(status['ssh:input']).toEqual({ count: 1, limit: 100 });
    });
  });
});
