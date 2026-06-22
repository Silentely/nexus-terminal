/**
 * Event Service 单元测试
 * 测试事件发布订阅的核心业务逻辑，包括增强功能：
 * - 类型安全
 * - 错误隔离
 * - 中间件链
 * - 域名事件
 * - 生命周期管理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('../utils/logger', () => ({ logger: mockLogger }));

// 需要在测试前重置模块以获得新的 EventService 实例
import eventService, { AppEventType } from './event.service';
import { EventDomain } from '../types/event.types';

describe('EventService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 清理所有监听器
    eventService.removeAllListeners();
  });

  afterEach(() => {
    eventService.removeAllListeners();
  });

  describe('emitEvent', () => {
    it('应正确发射事件并携带时间戳', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.LoginSuccess, listener);

      const payload = { userId: 1, details: { ip: '127.0.0.1' } };
      eventService.emitEvent(AppEventType.LoginSuccess, payload);

      expect(listener).toHaveBeenCalledTimes(1);
      const receivedPayload = listener.mock.calls[0][0];
      expect(receivedPayload.userId).toBe(1);
      expect(receivedPayload.details).toEqual({ ip: '127.0.0.1' });
      expect(receivedPayload.timestamp).toBeInstanceOf(Date);
    });

    it('应为不同事件类型发射不同的事件', () => {
      const loginListener = vi.fn();
      const logoutListener = vi.fn();

      eventService.onEvent(AppEventType.LoginSuccess, loginListener);
      eventService.onEvent(AppEventType.Logout, logoutListener);

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      expect(loginListener).toHaveBeenCalledTimes(1);
      expect(logoutListener).not.toHaveBeenCalled();
    });

    it('应支持多个监听器监听同一事件', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventService.onEvent(AppEventType.ConnectionCreated, listener1);
      eventService.onEvent(AppEventType.ConnectionCreated, listener2);

      eventService.emitEvent(AppEventType.ConnectionCreated, { details: { connectionId: 1 } });

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('onEvent', () => {
    it('应正确注册事件监听器', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.TagCreated, listener);

      eventService.emit(AppEventType.TagCreated, { timestamp: new Date() });

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('应能注册多个相同事件的监听器', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.ProxyCreated, listener);
      eventService.onEvent(AppEventType.ProxyCreated, listener);

      eventService.emitEvent(AppEventType.ProxyCreated, {});

      // 同一监听器注册两次应被调用两次
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('offEvent', () => {
    it('应正确移除事件监听器', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.ConnectionDeleted, listener);

      // 移除监听器
      eventService.offEvent(AppEventType.ConnectionDeleted, listener);

      eventService.emitEvent(AppEventType.ConnectionDeleted, {});

      expect(listener).not.toHaveBeenCalled();
    });

    it('移除不存在的监听器不应报错', () => {
      const listener = vi.fn();

      // 移除未注册的监听器
      expect(() => {
        eventService.offEvent(AppEventType.PasswordChanged, listener);
      }).not.toThrow();
    });

    it('应只移除指定的监听器，保留其他监听器', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      eventService.onEvent(AppEventType.TwoFactorEnabled, listener1);
      eventService.onEvent(AppEventType.TwoFactorEnabled, listener2);

      eventService.offEvent(AppEventType.TwoFactorEnabled, listener1);

      eventService.emitEvent(AppEventType.TwoFactorEnabled, {});

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe('AppEventType', () => {
    it('应包含所有预期的事件类型', () => {
      expect(AppEventType.TestNotification).toBe('testNotification');
      expect(AppEventType.LoginSuccess).toBe('LOGIN_SUCCESS');
      expect(AppEventType.LoginFailure).toBe('LOGIN_FAILURE');
      expect(AppEventType.Logout).toBe('LOGOUT');
      expect(AppEventType.PasswordChanged).toBe('PASSWORD_CHANGED');
      expect(AppEventType.TwoFactorEnabled).toBe('2FA_ENABLED');
      expect(AppEventType.TwoFactorDisabled).toBe('2FA_DISABLED');
      expect(AppEventType.ConnectionCreated).toBe('CONNECTION_CREATED');
      expect(AppEventType.ConnectionUpdated).toBe('CONNECTION_UPDATED');
      expect(AppEventType.ConnectionDeleted).toBe('CONNECTION_DELETED');
      expect(AppEventType.SettingsUpdated).toBe('SETTINGS_UPDATED');
    });
  });

  describe('最大监听器设置', () => {
    it('应设置较高的最大监听器限制', () => {
      // EventService 在构造函数中设置 maxListeners 为 50
      expect(eventService.getMaxListeners()).toBe(50);
    });
  });

  describe('事件负载', () => {
    it('应正确处理复杂的 details 对象', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.SshConnectSuccess, listener);

      const complexDetails = {
        connectionId: 1,
        connectionName: '测试服务器',
        host: '192.168.1.100',
        port: 22,
        metadata: {
          protocol: 'ssh',
          encryption: 'aes256-ctr',
        },
      };

      eventService.emitEvent(AppEventType.SshConnectSuccess, {
        userId: 1,
        details: complexDetails,
      });

      const receivedPayload = listener.mock.calls[0][0];
      expect(receivedPayload.details).toEqual(complexDetails);
    });

    it('应正确处理空的 payload', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.DatabaseMigration, listener);

      eventService.emitEvent(AppEventType.DatabaseMigration, {});

      expect(listener).toHaveBeenCalledTimes(1);
      const receivedPayload = listener.mock.calls[0][0];
      expect(receivedPayload.timestamp).toBeInstanceOf(Date);
    });

    it('应正确处理没有 userId 的 payload', () => {
      const listener = vi.fn();
      eventService.onEvent(AppEventType.AdminSetupComplete, listener);

      eventService.emitEvent(AppEventType.AdminSetupComplete, {
        details: { adminId: 1 },
      });

      const receivedPayload = listener.mock.calls[0][0];
      expect(receivedPayload.userId).toBeUndefined();
      expect(receivedPayload.details).toEqual({ adminId: 1 });
    });
  });

  // ========== 增强功能测试 ==========

  describe('错误隔离', () => {
    it('监听器抛出异常不应影响其他监听器', () => {
      const errorListener = vi.fn(() => {
        throw new Error('测试异常');
      });
      const normalListener = vi.fn();

      eventService.onEvent(AppEventType.LoginSuccess, errorListener);
      eventService.onEvent(AppEventType.LoginSuccess, normalListener);

      // 发射事件不应抛出异常
      expect(() => {
        eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });
      }).not.toThrow();

      // 两个监听器都应被调用
      expect(errorListener).toHaveBeenCalledTimes(1);
      expect(normalListener).toHaveBeenCalledTimes(1);

      // 错误应被记录
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('监听器执行异常'),
        expect.objectContaining({ eventType: AppEventType.LoginSuccess }),
      );
    });

    it('监听器异常不应影响发布者', () => {
      const errorListener = vi.fn(() => {
        throw new Error('测试异常');
      });

      eventService.onEvent(AppEventType.LoginSuccess, errorListener);

      // 发射事件的调用者不应收到异常
      expect(() => {
        eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });
      }).not.toThrow();
    });
  });

  describe('中间件系统', () => {
    it('应执行注册的中间件', () => {
      const middleware = vi.fn((_eventType, _payload, next) => {
        next();
      });
      eventService.useEventMiddleware(middleware);

      const listener = vi.fn();
      eventService.onEvent(AppEventType.LoginSuccess, listener);

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      expect(middleware).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('中间件应能修改 payload', () => {
      const middleware = vi.fn((eventType, payload, next) => {
        // 添加自定义字段（使用 Object.assign 避免 no-param-reassign）
        Object.assign(payload, { customField: 'middleware-added' });
        next();
      });
      eventService.useEventMiddleware(middleware);

      const listener = vi.fn();
      eventService.onEvent(AppEventType.LoginSuccess, listener);

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      const receivedPayload = listener.mock.calls[0][0];
      expect(receivedPayload.customField).toBe('middleware-added');
    });

    it('中间件异常不应阻止事件发送', () => {
      const errorMiddleware = vi.fn(() => {
        throw new Error('中间件异常');
      });
      eventService.useEventMiddleware(errorMiddleware);

      const listener = vi.fn();
      eventService.onEvent(AppEventType.LoginSuccess, listener);

      expect(() => {
        eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });
      }).not.toThrow();

      // 事件仍应被发送
      expect(listener).toHaveBeenCalledTimes(1);
      // 错误应被记录
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('中间件执行异常'),
        expect.any(Object),
      );
    });

    it('多个中间件应按顺序执行', () => {
      const order: number[] = [];
      const middleware1 = vi.fn((_e, _p, next) => {
        order.push(1);
        next();
      });
      const middleware2 = vi.fn((_e, _p, next) => {
        order.push(2);
        next();
      });

      eventService.useEventMiddleware(middleware1);
      eventService.useEventMiddleware(middleware2);

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      expect(order).toEqual([1, 2]);
    });
  });

  describe('域名事件', () => {
    it('应能按域名批量订阅事件', () => {
      const listener = vi.fn();
      eventService.onDomainEvent(EventDomain.Auth, listener);

      // 发射 Auth 域名的事件
      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith(
        AppEventType.LoginSuccess,
        expect.objectContaining({ userId: 1 }),
      );
    });

    it('域名订阅不应收到其他域名的事件', () => {
      const authListener = vi.fn();
      eventService.onDomainEvent(EventDomain.Auth, authListener);

      // 发射 Tag 域名的事件
      eventService.emitEvent(AppEventType.TagCreated, { details: { tagId: 1 } });

      expect(authListener).not.toHaveBeenCalled();
    });

    it('应能通过清理函数取消域名订阅', () => {
      const listener = vi.fn();
      const cleanup = eventService.onDomainEvent(EventDomain.Auth, listener);

      // 清理订阅
      cleanup();

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      expect(listener).not.toHaveBeenCalled();
    });

    it('offDomainEvent 应取消指定域名的所有订阅', () => {
      const listener = vi.fn();
      eventService.onDomainEvent(EventDomain.Auth, listener);

      eventService.offDomainEvent(EventDomain.Auth);

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('生命周期管理', () => {
    it('onEventWithCleanup 应返回可调用的清理函数', () => {
      const listener = vi.fn();
      const cleanup = eventService.onEventWithCleanup(AppEventType.LoginSuccess, listener);

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 1 });
      expect(listener).toHaveBeenCalledTimes(1);

      // 调用清理函数
      cleanup();

      eventService.emitEvent(AppEventType.LoginSuccess, { userId: 2 });
      expect(listener).toHaveBeenCalledTimes(1); // 不再被调用
    });

    it('多次调用清理函数不应报错', () => {
      const listener = vi.fn();
      const cleanup = eventService.onEventWithCleanup(AppEventType.LoginSuccess, listener);

      cleanup();
      expect(() => cleanup()).not.toThrow();
    });
  });
});
