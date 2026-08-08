import { beforeEach, describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import MultiServerExec from './MultiServerExec.vue';

const {
  batchStoreMock,
  confirmDialogMock,
  notificationsMock,
  sessionStoreMock,
  createWsManagerMock,
  wsUnsubscribeMock,
} = vi.hoisted(() => {
  const unsubscribeHandlerMock = vi.fn();
  const createWsManager = () => ({
    onMessage: vi.fn(
      (_type: string, _handler: (payload: unknown, message?: unknown) => void): (() => void) =>
        unsubscribeHandlerMock,
    ),
  });

  return {
    batchStoreMock: {
      currentTask: null as any,
      error: null as string | null,
      isExecuting: false,
      executeBatch: vi.fn(),
      cancelTask: vi.fn(),
      getConnectionStatus: vi.fn(() => null),
      clearError: vi.fn(),
      fetchTaskStatus: vi.fn(),
      handleBatchWsEvent: vi.fn(),
      wsEventReceived: false,
    },
    confirmDialogMock: vi.fn(),
    notificationsMock: {
      showSuccess: vi.fn(),
      showError: vi.fn(),
    },
    sessionStoreMock: {
      activeSessionId: 'session-1',
      activeSession: { wsManager: createWsManager() },
    },
    createWsManagerMock: createWsManager,
    wsUnsubscribeMock: unsubscribeHandlerMock,
  };
});

// Mock i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key: string) => key }),
}));

// Mock BatchStore
vi.mock('../../stores/batch.store', () => ({
  useBatchStore: () => batchStoreMock,
}));

vi.mock('../../composables/useConfirmDialog', () => ({
  useConfirmDialog: () => ({
    showConfirmDialog: confirmDialogMock,
  }),
}));

vi.mock('../../stores/uiNotifications.store', () => ({
  useUiNotificationsStore: () => notificationsMock,
}));

vi.mock('../../stores/session.store', () => ({
  useSessionStore: () => sessionStoreMock,
}));

// Mock ConnectionsStore
vi.mock('../../stores/connections.store', () => ({
  useConnectionsStore: () => ({
    connections: [
      { id: 1, name: 'S1', type: 'SSH' },
      { id: 2, name: 'R1', type: 'RDP' },
    ],
    fetchConnections: vi.fn(),
  }),
}));

describe('MultiServerExec.vue', () => {
  beforeEach(() => {
    batchStoreMock.currentTask = null;
    batchStoreMock.error = null;
    batchStoreMock.isExecuting = false;
    batchStoreMock.executeBatch.mockReset();
    batchStoreMock.cancelTask.mockReset();
    batchStoreMock.getConnectionStatus.mockClear();
    batchStoreMock.clearError.mockClear();
    batchStoreMock.fetchTaskStatus.mockReset();
    batchStoreMock.handleBatchWsEvent.mockReset();
    sessionStoreMock.activeSessionId = 'session-1';
    sessionStoreMock.activeSession = { wsManager: createWsManagerMock() };
    wsUnsubscribeMock.mockReset();
    confirmDialogMock.mockReset();
    confirmDialogMock.mockResolvedValue(true);
    notificationsMock.showSuccess.mockReset();
    notificationsMock.showError.mockReset();
  });

  it('filters connections to show only SSH types', () => {
    setActivePinia(createPinia());

    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
          StatusBadge: true,
          StatusIcon: true,
        },
      },
    });

    const vm = wrapper.vm as any;
    // Check computed property 'connections'
    expect(vm.connections).toHaveLength(1);
    expect(vm.connections[0].type).toBe('SSH');
  });

  it('所有按钮都应显式声明 button 类型，命令输入应关联可访问标签', () => {
    setActivePinia(createPinia());

    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
          StatusBadge: true,
          StatusIcon: true,
        },
      },
    });

    expect(
      wrapper.findAll('button').every((button) => button.attributes('type') === 'button'),
    ).toBe(true);
    const commandInput = wrapper.get('#batch-command');
    expect(commandInput.attributes('aria-labelledby')).toBe('batch-command-label');
    expect(wrapper.get('#batch-command-label').attributes('for')).toBe('batch-command');
  });

  it('sudo 执行应使用统一确认对话框，而不是原生 confirm', async () => {
    batchStoreMock.executeBatch.mockResolvedValue('task-1');
    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
          StatusBadge: true,
          StatusIcon: true,
        },
      },
    });

    await wrapper.get('input[type="checkbox"]').setValue(true);
    await wrapper.get('#batch-command').setValue('whoami');
    await wrapper.find('#batch-sudo').setValue(true);
    await wrapper.find('button[aria-label="batchOps.execute"]').trigger('click');

    expect(confirmDialogMock).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'batchOps.sudoConfirmTitle' }),
    );
    expect(batchStoreMock.executeBatch).toHaveBeenCalledWith(
      expect.objectContaining({ command: 'whoami', sudo: true }),
    );
  });

  it('复制输出成功应显示通知并提供即时反馈', async () => {
    batchStoreMock.currentTask = {
      taskId: 'task-1',
      status: 'completed',
      overallProgress: 100,
      subTasks: [
        {
          subTaskId: 'sub-1',
          connectionId: 1,
          connectionName: 'S1',
          status: 'completed',
          progress: 100,
          output: 'hello',
        },
      ],
    };
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
          StatusBadge: true,
          StatusIcon: true,
        },
      },
    });

    await wrapper.find('button[aria-label="batchOps.viewOutput"]').trigger('click');
    await wrapper.find('button[title="batchOps.copyOutput"]').trigger('click');

    expect(writeText).toHaveBeenCalledWith('hello');
    expect(notificationsMock.showSuccess).toHaveBeenCalledWith('batchOps.copySuccess');
    expect(wrapper.text()).toContain('batchOps.copied');
  });

  it('应把当前 SSH 会话的批量 WS 事件转发给 Batch Store', () => {
    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
          StatusBadge: true,
          StatusIcon: true,
        },
      },
    });

    const onMessage = sessionStoreMock.activeSession.wsManager.onMessage;
    const completedHandler = onMessage.mock.calls.find(([type]) => type === 'batch:completed')?.[1];

    expect(completedHandler).toEqual(expect.any(Function));
    completedHandler?.({ taskId: 'task-1', status: 'completed' });
    expect(batchStoreMock.handleBatchWsEvent).toHaveBeenCalledWith('batch:completed', {
      taskId: 'task-1',
      status: 'completed',
    });

    wrapper.unmount();
  });

  it('应注册全部批量事件并在卸载时注销处理器', () => {
    const wrapper = mount(MultiServerExec, {
      global: {
        stubs: {
          StatusBadge: true,
          StatusIcon: true,
        },
      },
    });

    const onMessage = sessionStoreMock.activeSession.wsManager.onMessage;
    expect(onMessage.mock.calls.map(([type]) => type)).toEqual([
      'batch:started',
      'batch:subtask:update',
      'batch:overall',
      'batch:completed',
      'batch:failed',
      'batch:cancelled',
      'batch:log',
    ]);

    wrapper.unmount();
    expect(wsUnsubscribeMock).toHaveBeenCalledTimes(7);
  });
});
