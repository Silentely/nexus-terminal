/**
 * composables/workspaceEvents 单元测试
 * 覆盖 mitt 事件发射器的订阅/发布/退订与自动清理逻辑
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// useOnWorkspaceEvent 依赖 onBeforeUnmount，mock 为立即执行注册回调
const unmountCallbacks: Array<() => void> = [];
vi.mock('vue', async (importOriginal) => {
  const actual = await importOriginal<typeof import('vue')>();
  return {
    ...actual,
    onBeforeUnmount: (fn: () => void) => {
      unmountCallbacks.push(fn);
    },
  };
});

describe('workspaceEvents', () => {
  let mod: typeof import('./workspaceEvents');

  beforeEach(async () => {
    unmountCallbacks.length = 0;
    vi.resetModules();
    mod = await import('./workspaceEvents');
  });

  it('useWorkspaceEventEmitter 应返回 emit 函数', () => {
    expect(typeof mod.useWorkspaceEventEmitter()).toBe('function');
  });

  it('useWorkspaceEventSubscriber 应返回 on 函数', () => {
    expect(typeof mod.useWorkspaceEventSubscriber()).toBe('function');
  });

  it('订阅后 emit 应触发处理器并携带载荷', () => {
    const handler = vi.fn();
    const emitter = mod.workspaceEmitter;

    emitter.on('terminal:sendCommand', handler);
    emitter.emit('terminal:sendCommand', { command: 'ls -la', sessionId: 's1' });

    expect(handler).toHaveBeenCalledWith({ command: 'ls -la', sessionId: 's1' });
  });

  it('useWorkspaceEventEmitter 的 emit 应能触发订阅', () => {
    const handler = vi.fn();
    const emitter = mod.workspaceEmitter;
    const emit = mod.useWorkspaceEventEmitter();

    emitter.on('connection:connect', handler);
    emit('connection:connect', { connectionId: 42 });

    expect(handler).toHaveBeenCalledWith({ connectionId: 42 });
  });

  it('off 退订后 emit 不应再触发', () => {
    const handler = vi.fn();
    const emitter = mod.workspaceEmitter;

    emitter.on('search:start', handler);
    emitter.off('search:start', handler);
    emitter.emit('search:start', { term: 'abc' });

    expect(handler).not.toHaveBeenCalled();
  });

  it('useOnWorkspaceEvent 注册后 emit 应触发，卸载回调执行退订', () => {
    const handler = vi.fn();
    const emitter = mod.workspaceEmitter;

    mod.useOnWorkspaceEvent('editor:saveTab', handler);
    emitter.emit('editor:saveTab', { tabId: 't1' });
    expect(handler).toHaveBeenCalledWith({ tabId: 't1' });

    // 执行卸载回调（模拟组件卸载）
    unmountCallbacks.forEach((cb) => cb());
    handler.mockClear();
    emitter.emit('editor:saveTab', { tabId: 't2' });
    expect(handler).not.toHaveBeenCalled();
  });
});
