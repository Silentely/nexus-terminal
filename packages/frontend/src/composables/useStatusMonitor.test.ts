/**
 * useStatusMonitor 单元测试
 * 覆盖 status_update 会话过滤与 session remapping 后的消息接收
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computed, ref } from 'vue';
import { createStatusMonitorManager, type StatusMonitorDependencies } from './useStatusMonitor';
import type { WebSocketMessage } from '../types/websocket.types';

const mockUsedPanes = new Set<string>(['statusMonitor']);

vi.mock('../stores/layout.store', () => ({
  useLayoutStore: () => ({
    usedPanes: mockUsedPanes,
  }),
}));

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('createStatusMonitorManager', () => {
  type TestHandler = (payload: unknown, message?: WebSocketMessage) => void;

  let messageHandlers: Map<string, TestHandler[]>;
  let mockOnMessage: ReturnType<typeof vi.fn>;
  let mockIsConnected: ReturnType<typeof ref<boolean>>;

  function createWsDeps(): StatusMonitorDependencies {
    return {
      onMessage: mockOnMessage,
      isConnected: computed(() => mockIsConnected.value ?? false),
    };
  }

  function triggerMessage(type: string, payload: unknown, message?: Partial<WebSocketMessage>) {
    const handlers = messageHandlers.get(type) || [];
    const fullMessage = {
      type,
      payload,
      ...message,
    } as WebSocketMessage;
    handlers.forEach((handler) => handler(payload, fullMessage));
  }

  beforeEach(() => {
    messageHandlers = new Map();
    mockIsConnected = ref(true);
    mockUsedPanes.clear();
    mockUsedPanes.add('statusMonitor');

    mockOnMessage = vi.fn((type: string, handler: TestHandler) => {
      const existing = messageHandlers.get(type);
      if (existing) {
        existing.push(handler);
      } else {
        messageHandlers.set(type, [handler]);
      }
      return () => {
        const list = messageHandlers.get(type) || [];
        const idx = list.indexOf(handler);
        if (idx >= 0) list.splice(idx, 1);
      };
    });
  });

  it('应接受与当前会话 sid 匹配的 status_update', () => {
    const manager = createStatusMonitorManager('frontend-sid', createWsDeps());
    manager.registerStatusHandlers();

    triggerMessage(
      'status_update',
      {
        connectionId: 1,
        status: { cpuPercent: 12.5, memUsed: 512, memTotal: 1024, timestamp: Date.now() },
      },
      { sid: 'frontend-sid' },
    );

    expect(manager.serverStatus.value?.cpuPercent).toBe(12.5);
    expect(manager.statusError.value).toBeNull();
  });

  it('应忽略其他会话的 status_update', () => {
    const manager = createStatusMonitorManager('frontend-sid', createWsDeps());
    manager.registerStatusHandlers();

    triggerMessage(
      'status_update',
      {
        connectionId: 1,
        status: { cpuPercent: 99, timestamp: Date.now() },
      },
      { sid: 'other-session' },
    );

    expect(manager.serverStatus.value).toBeNull();
  });

  it('会话 remap 后应接受后端 sid 的 status_update（修复服务器状态不显示）', () => {
    const manager = createStatusMonitorManager('frontend-temp-sid', createWsDeps());
    manager.registerStatusHandlers();

    // 模拟后端注入 sid 后、前端尚未 remap 的时间窗：应丢弃
    triggerMessage(
      'status_update',
      {
        connectionId: 1,
        status: { cpuPercent: 5, timestamp: Date.now() },
      },
      { sid: 'backend-uuid', sessionId: 'backend-uuid' },
    );
    expect(manager.serverStatus.value).toBeNull();

    // ssh:connected 后 remap
    manager.updateSessionId('backend-uuid');

    triggerMessage(
      'status_update',
      {
        connectionId: 1,
        status: {
          cpuPercent: 33.3,
          memUsed: 256,
          memTotal: 2048,
          netRxRate: 100,
          netTxRate: 50,
          timestamp: Date.now(),
        },
      },
      { sid: 'backend-uuid', sessionId: 'backend-uuid' },
    );

    expect(manager.serverStatus.value?.cpuPercent).toBe(33.3);
    expect(manager.serverStatus.value?.memUsed).toBe(256);
    expect(manager.cpuHistory.value[manager.cpuHistory.value.length - 1]).toBe(33.3);
  });

  it('无 sid/sessionId 的 status_update 应被接受（兼容专属 WS）', () => {
    const manager = createStatusMonitorManager('frontend-sid', createWsDeps());
    manager.registerStatusHandlers();

    triggerMessage('status_update', {
      connectionId: 1,
      status: { cpuPercent: 8, timestamp: Date.now() },
    });

    expect(manager.serverStatus.value?.cpuPercent).toBe(8);
  });

  it('status:error 在 remap 后应能按后端 sid 更新错误状态', () => {
    const manager = createStatusMonitorManager('frontend-temp-sid', createWsDeps());
    manager.registerStatusHandlers();
    manager.updateSessionId('backend-uuid');

    // 先写入正常状态
    triggerMessage(
      'status_update',
      { status: { cpuPercent: 1, timestamp: Date.now() } },
      { sid: 'backend-uuid' },
    );
    expect(manager.serverStatus.value).not.toBeNull();

    triggerMessage(
      'status:error',
      { connectionId: 1, message: '获取状态失败: timeout' },
      { sid: 'backend-uuid', sessionId: 'backend-uuid' },
    );

    expect(manager.serverStatus.value).toBeNull();
    expect(manager.statusError.value).toBe('获取状态失败: timeout');
  });

  it('updateSessionId 相同 ID 时应为幂等', () => {
    const manager = createStatusMonitorManager('sid-a', createWsDeps());
    manager.updateSessionId('sid-a');
    manager.registerStatusHandlers();

    triggerMessage(
      'status_update',
      { status: { cpuPercent: 7, timestamp: Date.now() } },
      { sid: 'sid-a' },
    );
    expect(manager.serverStatus.value?.cpuPercent).toBe(7);
  });
});
