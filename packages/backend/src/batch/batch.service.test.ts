/**
 * Batch Service 单元测试
 * 测试批量命令执行的核心业务逻辑
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  execCommandBatch,
  getTaskStatus,
  getTasksByUser,
  cancelTask,
  deleteTask,
  cleanupOldTasks,
} from './batch.service';
import * as BatchRepository from './batch.repository';
import * as SshService from '../services/ssh.service';
import { broadcastToUser } from '../websocket/state';
import * as ConnectionRepository from '../connections/connection.repository';
import type { BatchTask, BatchExecPayload } from './batch.types';

// Mock 依赖模块
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'mock-uuid-1234'),
}));

vi.mock('./batch.repository', () => ({
  createTask: vi.fn(),
  getTask: vi.fn(),
  getTasksByUser: vi.fn(),
  updateTaskStatus: vi.fn(),
  updateSubTaskStatus: vi.fn(),
  appendSubTaskOutput: vi.fn(),
  cancelSubTasks: vi.fn(),
  deleteTask: vi.fn(),
  cleanupOldTasks: vi.fn(),
}));

vi.mock('../services/ssh.service', () => ({
  getConnectionDetails: vi.fn(),
  establishSshConnection: vi.fn(),
}));

vi.mock('../websocket/state', () => ({
  broadcastToUser: vi.fn(),
}));

vi.mock('../connections/connection.repository', () => ({
  findConnectionByIdWithTags: vi.fn(),
}));

describe('Batch Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.resetAllMocks();
  });

  describe('execCommandBatch', () => {
    const mockPayload: BatchExecPayload = {
      connectionIds: [1, 2],
      command: 'echo "hello"',
      concurrencyLimit: 2,
    };

    it('应创建批量任务并返回任务对象', async () => {
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        id: 1,
        name: '测试服务器',
      });
      (BatchRepository.createTask as any).mockResolvedValue(undefined);
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await execCommandBatch(mockPayload, 1);

      expect(result.taskId).toBe('mock-uuid-1234');
      expect(result.userId).toBe(1);
      expect(result.status).toBe('queued');
      expect(result.totalSubTasks).toBe(2);
      expect(result.subTasks).toHaveLength(2);
      expect(BatchRepository.createTask).toHaveBeenCalledTimes(1);
    });

    it('应使用默认并发限制当未指定时', async () => {
      const payloadWithoutConcurrency: BatchExecPayload = {
        connectionIds: [1],
        command: 'ls',
      };
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        id: 1,
        name: '服务器1',
      });
      (BatchRepository.createTask as any).mockResolvedValue(undefined);
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await execCommandBatch(payloadWithoutConcurrency, 1);

      expect(result.concurrencyLimit).toBe(5); // DEFAULT_CONCURRENCY
    });

    it('应正确处理字符串类型的 userId', async () => {
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        id: 1,
        name: '服务器1',
      });
      (BatchRepository.createTask as any).mockResolvedValue(undefined);
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await execCommandBatch(mockPayload, '123');

      expect(result.userId).toBe('123');
    });

    it('应在获取连接名称失败时使用默认名称', async () => {
      (ConnectionRepository.findConnectionByIdWithTags as any).mockRejectedValue(
        new Error('Connection not found')
      );
      (BatchRepository.createTask as any).mockResolvedValue(undefined);
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await execCommandBatch(mockPayload, 1);

      expect(result.subTasks[0].connectionName).toBe('连接 #1');
    });

    it('应为每个连接创建子任务', async () => {
      const payloadMultiple: BatchExecPayload = {
        connectionIds: [1, 2, 3],
        command: 'uptime',
      };
      (ConnectionRepository.findConnectionByIdWithTags as any).mockResolvedValue({
        id: 1,
        name: '服务器',
      });
      (BatchRepository.createTask as any).mockResolvedValue(undefined);
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await execCommandBatch(payloadMultiple, 1);

      expect(result.subTasks).toHaveLength(3);
      expect(result.subTasks.every((st) => st.status === 'queued')).toBe(true);
      expect(result.subTasks.every((st) => st.command === 'uptime')).toBe(true);
    });
  });

  describe('getTaskStatus', () => {
    it('应返回任务状态', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'in-progress',
        concurrencyLimit: 5,
        overallProgress: 50,
        totalSubTasks: 2,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1, 2], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);

      const result = await getTaskStatus('task-1');

      expect(result).toEqual(mockTask);
      expect(BatchRepository.getTask).toHaveBeenCalledWith('task-1');
    });

    it('任务不存在时应返回 null', async () => {
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await getTaskStatus('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getTasksByUser', () => {
    it('应返回用户的任务列表', async () => {
      const mockTasks: BatchTask[] = [
        {
          taskId: 'task-1',
          userId: 1,
          status: 'completed',
          concurrencyLimit: 5,
          overallProgress: 100,
          totalSubTasks: 1,
          completedSubTasks: 1,
          failedSubTasks: 0,
          cancelledSubTasks: 0,
          payload: { connectionIds: [1], command: 'ls' },
          subTasks: [],
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      (BatchRepository.getTasksByUser as any).mockResolvedValue(mockTasks);

      const result = await getTasksByUser(1, 20, 0);

      expect(result).toEqual(mockTasks);
      expect(BatchRepository.getTasksByUser).toHaveBeenCalledWith(1, 20, 0);
    });

    it('应使用默认分页参数', async () => {
      (BatchRepository.getTasksByUser as any).mockResolvedValue([]);

      await getTasksByUser(1);

      expect(BatchRepository.getTasksByUser).toHaveBeenCalledWith(1, 20, 0);
    });

    it('无任务时应返回空数组', async () => {
      (BatchRepository.getTasksByUser as any).mockResolvedValue([]);

      const result = await getTasksByUser(999);

      expect(result).toEqual([]);
    });
  });

  describe('cancelTask', () => {
    it('应成功取消执行中的任务', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'in-progress',
        concurrencyLimit: 5,
        overallProgress: 30,
        totalSubTasks: 3,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1, 2, 3], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.cancelSubTasks as any).mockResolvedValue(2);

      const result = await cancelTask('task-1', '用户主动取消');

      expect(result).toBe(true);
      expect(BatchRepository.cancelSubTasks).toHaveBeenCalledWith('task-1', '用户主动取消');
      expect(broadcastToUser).toHaveBeenCalledWith(1, {
        type: 'batch:cancelled',
        payload: { taskId: 'task-1', reason: '用户主动取消' },
      });
    });

    it('应使用默认取消原因', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'queued',
        concurrencyLimit: 5,
        overallProgress: 0,
        totalSubTasks: 1,
        completedSubTasks: 0,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.cancelSubTasks as any).mockResolvedValue(1);

      await cancelTask('task-1');

      expect(BatchRepository.cancelSubTasks).toHaveBeenCalledWith('task-1', '用户取消');
    });

    it('任务不存在时应返回 false', async () => {
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await cancelTask('non-existent');

      expect(result).toBe(false);
      expect(BatchRepository.cancelSubTasks).not.toHaveBeenCalled();
    });

    it('已完成的任务不可取消', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'completed',
        concurrencyLimit: 5,
        overallProgress: 100,
        totalSubTasks: 1,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);

      const result = await cancelTask('task-1');

      expect(result).toBe(false);
    });

    it('已失败的任务不可取消', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'failed',
        concurrencyLimit: 5,
        overallProgress: 100,
        totalSubTasks: 1,
        completedSubTasks: 0,
        failedSubTasks: 1,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);

      const result = await cancelTask('task-1');

      expect(result).toBe(false);
    });

    it('已取消的任务不可再次取消', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'cancelled',
        concurrencyLimit: 5,
        overallProgress: 0,
        totalSubTasks: 1,
        completedSubTasks: 0,
        failedSubTasks: 0,
        cancelledSubTasks: 1,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);

      const result = await cancelTask('task-1');

      expect(result).toBe(false);
    });
  });

  describe('deleteTask', () => {
    it('应成功删除属于用户的任务', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'completed',
        concurrencyLimit: 5,
        overallProgress: 100,
        totalSubTasks: 1,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.deleteTask as any).mockResolvedValue(undefined);

      const result = await deleteTask('task-1', 1);

      expect(result).toBe(true);
      expect(BatchRepository.deleteTask).toHaveBeenCalledWith('task-1');
    });

    it('任务不存在时应返回 false', async () => {
      (BatchRepository.getTask as any).mockResolvedValue(null);

      const result = await deleteTask('non-existent', 1);

      expect(result).toBe(false);
      expect(BatchRepository.deleteTask).not.toHaveBeenCalled();
    });

    it('不允许删除其他用户的任务', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 2,
        status: 'completed',
        concurrencyLimit: 5,
        overallProgress: 100,
        totalSubTasks: 1,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);

      const result = await deleteTask('task-1', 1);

      expect(result).toBe(false);
      expect(BatchRepository.deleteTask).not.toHaveBeenCalled();
    });

    it('删除执行中的任务应先取消', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'in-progress',
        concurrencyLimit: 5,
        overallProgress: 50,
        totalSubTasks: 2,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1, 2], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.cancelSubTasks as any).mockResolvedValue(1);
      (BatchRepository.deleteTask as any).mockResolvedValue(undefined);

      const result = await deleteTask('task-1', 1);

      expect(result).toBe(true);
      expect(BatchRepository.cancelSubTasks).toHaveBeenCalled();
      expect(BatchRepository.deleteTask).toHaveBeenCalledWith('task-1');
    });

    it('删除排队中的任务应先取消', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 1,
        status: 'queued',
        concurrencyLimit: 5,
        overallProgress: 0,
        totalSubTasks: 1,
        completedSubTasks: 0,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.cancelSubTasks as any).mockResolvedValue(1);
      (BatchRepository.deleteTask as any).mockResolvedValue(undefined);

      const result = await deleteTask('task-1', 1);

      expect(result).toBe(true);
      expect(BatchRepository.cancelSubTasks).toHaveBeenCalled();
    });

    it('应支持字符串类型的 userId 比较', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: '1',
        status: 'completed',
        concurrencyLimit: 5,
        overallProgress: 100,
        totalSubTasks: 1,
        completedSubTasks: 1,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.deleteTask as any).mockResolvedValue(undefined);

      const result = await deleteTask('task-1', 1);

      expect(result).toBe(true);
    });
  });

  describe('cleanupOldTasks', () => {
    it('应清理过期任务并返回清理数量', async () => {
      (BatchRepository.cleanupOldTasks as any).mockResolvedValue(5);

      const result = await cleanupOldTasks(7);

      expect(result).toBe(5);
      expect(BatchRepository.cleanupOldTasks).toHaveBeenCalledWith(7);
    });

    it('应使用默认天数 7', async () => {
      (BatchRepository.cleanupOldTasks as any).mockResolvedValue(0);

      await cleanupOldTasks();

      expect(BatchRepository.cleanupOldTasks).toHaveBeenCalledWith(7);
    });

    it('无过期任务时应返回 0', async () => {
      (BatchRepository.cleanupOldTasks as any).mockResolvedValue(0);

      const result = await cleanupOldTasks(30);

      expect(result).toBe(0);
    });
  });

  describe('WebSocket 消息广播', () => {
    it('无效 userId 应跳过广播', async () => {
      const mockTask: BatchTask = {
        taskId: 'task-1',
        userId: 'invalid-user',
        status: 'in-progress',
        concurrencyLimit: 5,
        overallProgress: 0,
        totalSubTasks: 1,
        completedSubTasks: 0,
        failedSubTasks: 0,
        cancelledSubTasks: 0,
        payload: { connectionIds: [1], command: 'ls' },
        subTasks: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      (BatchRepository.getTask as any).mockResolvedValue(mockTask);
      (BatchRepository.cancelSubTasks as any).mockResolvedValue(1);

      await cancelTask('task-1');

      // sendBatchEvent 在 userId 解析为 NaN 时直接返回，不会调用 broadcastToUser
      expect(broadcastToUser).not.toHaveBeenCalled();
    });
  });
});
