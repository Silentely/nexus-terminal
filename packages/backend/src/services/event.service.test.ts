/**
 * Event Service 单元测试
 * 测试事件发布订阅的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 需要在测试前重置模块以获得新的 EventService 实例
import eventService, { AppEventType, AppEventPayload } from './event.service';

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

    it('应在控制台打印事件日志', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

      eventService.emitEvent(AppEventType.SettingsUpdated, { details: { key: 'theme' } });

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Event emitted:'),
        expect.objectContaining({ details: { key: 'theme' } })
      );
      consoleSpy.mockRestore();
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
});
