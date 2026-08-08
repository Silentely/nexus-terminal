import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useBatchStore } from './batch.store';
import apiClient from '../utils/apiClient';
import type {
  BatchTask,
  BatchSubTask,
  BatchExecPayload,
  BatchExecResponse,
  BatchStatusResponse,
  BatchTaskListResponse,
  BatchCancelResponse,
} from '../types/batch.types';

vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    delete: vi.fn(),
  },
}));

describe('batch.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  const mockSubTasks: BatchSubTask[] = [
    {
      subTaskId: 'sub-1',
      taskId: 'task-123',
      connectionId: 1,
      connectionName: '服务器1',
      command: 'ls -la',
      status: 'queued',
      progress: 0,
    },
    {
      subTaskId: 'sub-2',
      taskId: 'task-123',
      connectionId: 2,
      connectionName: '服务器2',
      command: 'ls -la',
      status: 'queued',
      progress: 0,
    },
  ];

  const mockTask: BatchTask = {
    taskId: 'task-123',
    userId: 1,
    status: 'in-progress',
    concurrencyLimit: 2,
    overallProgress: 50,
    totalSubTasks: 2,
    completedSubTasks: 1,
    failedSubTasks: 0,
    cancelledSubTasks: 0,
    payload: {
      command: 'ls -la',
      connectionIds: [1, 2],
      concurrencyLimit: 2,
    },
    subTasks: mockSubTasks,
    createdAt: new Date('2023-01-01'),
    updatedAt: new Date('2023-01-02'),
  };

  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useBatchStore();

      expect(store.currentTask).toBeNull();
      expect(store.tasks).toEqual([]);
      expect(store.isExecuting).toBe(false);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.subTaskStatusMap).toEqual({});
    });
  });

  describe('Getters', () => {
    it('hasActiveTask 应在有进行中任务时返回 true', () => {
      const store = useBatchStore();
      store.currentTask = { ...mockTask, status: 'in-progress' };

      expect(store.hasActiveTask).toBe(true);
    });

    it('hasActiveTask 任务已完成时应返回 false', () => {
      const store = useBatchStore();
      store.currentTask = { ...mockTask, status: 'completed' };

      expect(store.hasActiveTask).toBe(false);
    });

    it('overallProgress 应返回当前任务进度', () => {
      const store = useBatchStore();
      store.currentTask = { ...mockTask, overallProgress: 75 };

      expect(store.overallProgress).toBe(75);
    });
  });

  describe('executeBatch', () => {
    it('执行批量任务成功应设置当前任务和状态映射', async () => {
      const store = useBatchStore();

      const payload: BatchExecPayload = {
        command: 'ls -la',
        connectionIds: [1, 2],
        concurrencyLimit: 2,
      };

      const mockResponse: BatchExecResponse = {
        success: true,
        taskId: 'task-123',
        message: '任务已创建',
        task: mockTask as any,
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: mockResponse });

      const taskId = await store.executeBatch(payload);

      expect(taskId).toBe('task-123');
      expect(store.currentTask?.taskId).toBe('task-123');
      expect(store.isExecuting).toBe(true);
      expect(store.subTaskStatusMap['task-123']?.[1]).toBe('queued');
      expect(store.subTaskStatusMap['task-123']?.[2]).toBe('queued');
    });

    it('正在执行时再次调用应返回 null', async () => {
      const store = useBatchStore();
      store.isExecuting = true;

      const result = await store.executeBatch({
        command: 'ls',
        connectionIds: [1],
      });

      expect(result).toBeNull();
      expect(apiClient.post).not.toHaveBeenCalled();
    });

    it('执行失败应设置错误并停止执行', async () => {
      const store = useBatchStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce({
        response: { data: { message: '批量命令执行失败' } },
      });

      const taskId = await store.executeBatch({
        command: 'ls',
        connectionIds: [1],
      });

      expect(taskId).toBeNull();
      expect(store.error).toBe('批量命令执行失败');
      expect(store.isExecuting).toBe(false);
    });
  });

  describe('fetchTaskStatus', () => {
    it('获取任务状态成功应更新当前任务', async () => {
      const store = useBatchStore();
      store.currentTask = { ...mockTask };

      const updatedTask: BatchTask = {
        ...mockTask,
        overallProgress: 75,
        completedSubTasks: 2,
      };

      const mockResponse: BatchStatusResponse = {
        success: true,
        task: updatedTask as any,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockResponse });

      const result = await store.fetchTaskStatus('task-123');

      expect(result?.overallProgress).toBe(75);
      expect(store.currentTask?.overallProgress).toBe(75);
    });

    it('任务完成时应停止执行状态', async () => {
      const store = useBatchStore();
      store.currentTask = { ...mockTask };
      store.isExecuting = true;

      const completedTask: BatchTask = {
        ...mockTask,
        status: 'completed',
        overallProgress: 100,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { success: true, task: completedTask as any },
      });

      await store.fetchTaskStatus('task-123');

      expect(store.isExecuting).toBe(false);
    });

    it('获取失败应设置错误但保持执行状态', async () => {
      const store = useBatchStore();
      store.isExecuting = true;

      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '获取失败' } },
      });

      const result = await store.fetchTaskStatus('task-123');

      expect(result).toBeNull();
      expect(store.error).toBe('获取失败');
      expect(store.isExecuting).toBe(true); // 不应改变
    });
  });

  describe('fetchTaskList', () => {
    it('应获取任务列表', async () => {
      const store = useBatchStore();

      const mockResponse: BatchTaskListResponse = {
        success: true,
        tasks: [mockTask as any],
        total: 1,
        limit: 20,
        offset: 0,
      };

      vi.mocked(apiClient.get).mockResolvedValueOnce({ data: mockResponse });

      await store.fetchTaskList();

      expect(store.tasks).toHaveLength(1);
      expect(store.tasks[0].taskId).toBe('task-123');
    });
  });

  describe('cancelTask', () => {
    it('取消任务成功应刷新状态', async () => {
      const store = useBatchStore();

      const mockCancelResponse: BatchCancelResponse = {
        success: true,
        taskId: 'task-123',
        message: '任务已取消',
      };

      vi.mocked(apiClient.post).mockResolvedValueOnce({ data: mockCancelResponse });
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { success: true, task: { ...mockTask, status: 'cancelled' } as any },
      });

      const result = await store.cancelTask('task-123');

      expect(result).toBe(true);
    });

    it('取消失败应返回 false', async () => {
      const store = useBatchStore();

      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('取消失败'));

      const result = await store.cancelTask('task-123');

      expect(result).toBe(false);
      expect(store.error).toBe('取消失败');
    });
  });

  describe('deleteTask', () => {
    it('删除任务应从列表中移除', async () => {
      const store = useBatchStore();
      store.tasks = [mockTask];

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      const result = await store.deleteTask('task-123');

      expect(result).toBe(true);
      expect(store.tasks).toHaveLength(0);
    });

    it('删除当前任务应清空状态', async () => {
      const store = useBatchStore();
      store.currentTask = mockTask;
      store.isExecuting = true;

      vi.mocked(apiClient.delete).mockResolvedValueOnce({});

      await store.deleteTask('task-123');

      expect(store.currentTask).toBeNull();
      expect(store.isExecuting).toBe(false);
    });
  });

  describe('handleBatchWsEvent', () => {
    beforeEach(() => {
      const store = useBatchStore();
      // 使用深拷贝避免引用共享
      store.currentTask = {
        ...mockTask,
        subTasks: mockSubTasks.map((st) => ({ ...st })),
      };
    });

    it('batch:subtask:update 应更新子任务状态', () => {
      const store = useBatchStore();

      store.handleBatchWsEvent('batch:subtask:update', {
        taskId: 'task-123',
        subTaskId: 'sub-1',
        status: 'running',
        progress: 50,
        output: 'output line',
      });

      const subTask = store.currentTask?.subTasks.find((st) => st.subTaskId === 'sub-1');
      expect(subTask?.status).toBe('running');
      expect(subTask?.progress).toBe(50);
      expect(subTask?.output).toBe('output line');
      expect(store.subTaskStatusMap['task-123']?.[1]).toBe('running');
    });

    it('batch:overall 应更新整体进度', () => {
      const store = useBatchStore();

      store.handleBatchWsEvent('batch:overall', {
        taskId: 'task-123',
        status: 'partially-completed',
        overallProgress: 90,
        completed: 2,
        failed: 0,
      });

      expect(store.currentTask?.status).toBe('partially-completed');
      expect(store.currentTask?.overallProgress).toBe(90);
      expect(store.currentTask?.completedSubTasks).toBe(2);
    });

    it('batch:overall 应同步取消子任务数量', () => {
      const store = useBatchStore();
      store.currentTask = { ...mockTask, cancelledSubTasks: 0 };

      store.handleBatchWsEvent('batch:overall', {
        taskId: 'task-123',
        status: 'cancelled',
        overallProgress: 100,
        completed: 1,
        failed: 0,
        cancelled: 1,
      });

      expect(store.currentTask?.cancelledSubTasks).toBe(1);
    });

    it('batch:completed 应停止执行并刷新状态', () => {
      const store = useBatchStore();
      store.isExecuting = true;

      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: { success: true, task: { ...mockTask, status: 'completed' } as any },
      });

      store.handleBatchWsEvent('batch:completed', {
        taskId: 'task-123',
      });

      expect(store.isExecuting).toBe(false);
    });

    it('终态 REST 快照失败时仍应保留 WS 提供的本地终态', async () => {
      const store = useBatchStore();
      store.isExecuting = true;
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('快照暂时不可用'));

      store.handleBatchWsEvent('batch:cancelled', {
        taskId: 'task-123',
        status: 'cancelled',
        overallProgress: 100,
        completed: 1,
        failed: 0,
        cancelled: 1,
        reason: '主人主动取消',
      });

      await vi.waitFor(() => {
        expect(store.currentTask?.status).toBe('cancelled');
      });

      expect(store.currentTask?.overallProgress).toBe(100);
      expect(store.currentTask?.completedSubTasks).toBe(1);
      expect(store.currentTask?.cancelledSubTasks).toBe(1);
      expect(store.currentTask?.message).toBe('主人主动取消');
      expect(store.isExecuting).toBe(false);
    });

    it('旧的 in-progress REST 快照不应回退已收到的 WS 终态', async () => {
      const store = useBatchStore();
      store.isExecuting = true;
      vi.mocked(apiClient.get).mockResolvedValueOnce({
        data: {
          success: true,
          task: { ...mockTask, status: 'in-progress' } as any,
        },
      });

      store.handleBatchWsEvent('batch:cancelled', {
        taskId: 'task-123',
        status: 'cancelled',
        overallProgress: 100,
        cancelled: 1,
        reason: '主人主动取消',
      });

      await vi.waitFor(() => expect(apiClient.get).toHaveBeenCalledWith('/batch/task-123'));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(store.currentTask?.status).toBe('cancelled');
      expect(store.isExecuting).toBe(false);
    });

    it('batch:log 应追加流式输出', () => {
      const store = useBatchStore();

      store.handleBatchWsEvent('batch:log', {
        taskId: 'task-123',
        subTaskId: 'sub-1',
        chunk: 'new line\n',
      });

      const subTask = store.currentTask?.subTasks.find((st) => st.subTaskId === 'sub-1');
      expect(subTask?.output).toBe('new line\n');
    });

    it('非当前任务的事件应被忽略', () => {
      const store = useBatchStore();
      const originalTask = { ...store.currentTask };

      store.handleBatchWsEvent('batch:overall', {
        taskId: 'other-task',
        overallProgress: 100,
      });

      expect(store.currentTask).toEqual(originalTask);
    });
  });

  describe('getConnectionStatus', () => {
    it('应返回连接的执行状态', () => {
      const store = useBatchStore();
      store.subTaskStatusMap = { 'test-task': { 1: 'running', 2: 'completed' } };

      expect(store.getConnectionStatus(1, 'test-task')).toBe('running');
      expect(store.getConnectionStatus(2, 'test-task')).toBe('completed');
      expect(store.getConnectionStatus(3, 'test-task')).toBeNull();
    });
  });

  describe('getSubTaskByConnection', () => {
    it('应返回连接的子任务', () => {
      const store = useBatchStore();
      store.currentTask = mockTask;

      const subTask = store.getSubTaskByConnection(1);

      expect(subTask?.connectionId).toBe(1);
    });

    it('无当前任务时应返回 null', () => {
      const store = useBatchStore();

      expect(store.getSubTaskByConnection(1)).toBeNull();
    });
  });

  describe('reset', () => {
    it('应重置所有状态', () => {
      const store = useBatchStore();

      store.currentTask = mockTask;
      store.isExecuting = true;
      store.error = '错误';
      store.subTaskStatusMap = { 'test-task': { 1: 'running' } };
      store.wsEventReceived = true;

      store.reset();

      expect(store.currentTask).toBeNull();
      expect(store.isExecuting).toBe(false);
      expect(store.error).toBeNull();
      expect(store.subTaskStatusMap).toEqual({});
      expect(store.wsEventReceived).toBe(false);
    });
  });

  describe('clearError', () => {
    it('应清除错误状态', () => {
      const store = useBatchStore();
      store.error = '错误信息';

      store.clearError();

      expect(store.error).toBeNull();
    });
  });
});
