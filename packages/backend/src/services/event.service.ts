/**
 * 增强版事件服务
 * 提供类型安全、错误隔离、中间件链、领域命名空间和生命周期管理
 */
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import {
  AppEventType,
  type AppEventPayload,
  type EventMiddleware,
  type TypedEventPayload,
  EventDomain,
  DOMAIN_EVENTS,
} from '../types/event.types';

// 重新导出类型定义，保持向后兼容
export { AppEventType, type AppEventPayload } from '../types/event.types';

class EventService extends EventEmitter {
  private readonly middlewares: EventMiddleware[] = [];
  private readonly domainListeners: Map<
    EventDomain,
    Array<{ eventType: AppEventType; listener: (payload: AppEventPayload) => void }>
  > = new Map();

  constructor() {
    super();
    // 增加监听器数量限制，防止潜在的内存泄漏警告
    this.setMaxListeners(50);
  }

  // ========== 类型化重载签名 ==========

  emitEvent<T extends AppEventType>(
    eventType: T,
    payload: Omit<TypedEventPayload<T>, 'timestamp'>,
  ): void;
  emitEvent(eventType: AppEventType, payload: Omit<AppEventPayload, 'timestamp'>): void;
  emitEvent(eventType: AppEventType, payload: Omit<AppEventPayload, 'timestamp'>): void {
    const fullPayload: AppEventPayload = {
      ...payload,
      timestamp: new Date(),
    };

    // 执行中间件链
    this.runMiddlewareChain(eventType, fullPayload, () => {
      this.emitToListeners(eventType, fullPayload);
    });
  }

  // ========== 中间件系统 ==========

  /**
   * 注册事件中间件
   * 中间件按注册顺序依次执行，每个中间件必须调用 next() 继续链
   */
  useEventMiddleware(middleware: EventMiddleware): void {
    this.middlewares.push(middleware);
  }

  /**
   * 执行中间件链
   * 使用 called 标志位防止 finalAction 被重复执行
   */
  private runMiddlewareChain(
    eventType: AppEventType,
    payload: AppEventPayload,
    finalAction: () => void,
  ): void {
    const middlewares = this.middlewares;
    let index = 0;
    let finalActionCalled = false;

    const next = (): void => {
      if (index < middlewares.length) {
        const middleware = middlewares[index++];
        let called = false;
        try {
          middleware(eventType, payload, () => {
            if (called) return; // 幂等保护：防止 next() 被重复调用
            called = true;
            next();
          });
        } catch (error) {
          logger.error(`[EventService] 中间件执行异常: ${(error as Error).message}`, {
            eventType,
            middlewareIndex: index - 1,
          });
          // 中间件异常不阻止事件发送，继续执行后续中间件
          if (!called) {
            called = true;
            next();
          }
        }
      } else if (!finalActionCalled) {
        finalActionCalled = true;
        finalAction();
      }
    };

    next();
  }

  // ========== 错误隔离的事件发射 ==========

  /**
   * 向所有监听器发射事件，每个监听器调用都包裹在 try-catch 中
   * 确保单个监听器的异常不会影响其他监听器和发布者
   *
   * 注意：此实现绕过了 EventEmitter.emit()，直接遍历 listeners 数组。
   * 这是为了实现错误隔离而做的设计权衡。已知限制：
   * - once() 注册的监听器不会自动取消订阅（项目中未使用 once()）
   * - 监听器在执行过程中移除自身时，预计算的 listeners 数组仍会调用它
   * - 不支持 'error' 事件的特殊处理
   */
  private emitToListeners(eventType: AppEventType, payload: AppEventPayload): void {
    const listeners = this.listeners(eventType);
    for (const listener of listeners) {
      try {
        listener(payload);
      } catch (error) {
        logger.error(`[EventService] 监听器执行异常: ${(error as Error).message}`, {
          eventType,
          listenerName: listener.name || 'anonymous',
        });
        // 异常不冒泡，确保发布者不受影响
      }
    }
  }

  // ========== 域名事件方法 ==========

  /**
   * 按域名批量订阅事件
   * 自动订阅该域名下的所有事件类型
   * @returns 清理函数，调用后仅移除本次调用注册的监听器
   */
  onDomainEvent(
    domain: EventDomain,
    listener: (eventType: AppEventType, payload: AppEventPayload) => void,
  ): () => void {
    const domainEventTypes = DOMAIN_EVENTS[domain];
    if (!domainEventTypes) {
      logger.warn(`[EventService] 未知的事件域名: ${domain}`);
      return () => {};
    }

    const registrations: Array<{
      eventType: AppEventType;
      wrappedListener: (payload: AppEventPayload) => void;
    }> = [];

    for (const eventType of domainEventTypes) {
      const wrappedListener = (payload: AppEventPayload): void => {
        listener(eventType, payload);
      };
      this.on(eventType, wrappedListener);
      registrations.push({ eventType, wrappedListener });
    }

    // 记录域名监听器用于批量清理
    if (!this.domainListeners.has(domain)) {
      this.domainListeners.set(domain, []);
    }
    const domainRecords = this.domainListeners.get(domain) ?? [];
    for (const reg of registrations) {
      domainRecords.push({
        eventType: reg.eventType,
        listener: reg.wrappedListener,
      });
    }

    // 返回清理函数 - 仅移除本次调用注册的监听器
    return () => {
      for (const reg of registrations) {
        this.off(reg.eventType, reg.wrappedListener);
        // 从 domainListeners 中移除记录
        const records = this.domainListeners.get(domain);
        if (records) {
          const idx = records.findIndex((r) => r.listener === reg.wrappedListener);
          if (idx !== -1) records.splice(idx, 1);
          if (records.length === 0) this.domainListeners.delete(domain);
        }
      }
    };
  }

  /**
   * 取消指定域名下的所有事件订阅
   */
  offDomainEvent(domain: EventDomain): void {
    const domainRecords = this.domainListeners.get(domain);
    if (!domainRecords) return;

    for (const record of domainRecords) {
      this.off(record.eventType, record.listener);
    }
    this.domainListeners.delete(domain);
  }

  // ========== 生命周期管理 ==========

  /**
   * 注册事件监听器，返回清理函数
   * 比 onEvent + offEvent 更 ergonomic 的用法
   * @returns 清理函数，调用后自动取消订阅
   */
  onEventWithCleanup(
    eventType: AppEventType,
    listener: (payload: AppEventPayload) => void,
  ): () => void {
    this.on(eventType, listener);

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.off(eventType, listener);
    };
  }

  // ========== 向后兼容的 API ==========

  /**
   * 注册事件监听器（向后兼容）
   * @param eventType 事件类型
   * @param listener 监听函数
   */
  onEvent(eventType: AppEventType, listener: (payload: AppEventPayload) => void): void {
    this.on(eventType, listener);
  }

  /**
   * 移除事件监听器（向后兼容）
   * @param eventType 事件类型
   * @param listener 监听函数
   */
  offEvent(eventType: AppEventType, listener: (payload: AppEventPayload) => void): void {
    this.off(eventType, listener);
  }
}

// 创建单例
const eventService = new EventService();

export default eventService;
