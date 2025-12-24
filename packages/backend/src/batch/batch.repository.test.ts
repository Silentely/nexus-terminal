/**
 * Batch Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as batchRepository from './batch.repository';
import type { BatchTask, BatchSubTask, BatchExecPayload } from './batch.types';

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

describe('Batch Repository', () => {
  const mockPayload: BatchExecPayload = {
    command: 'echo "test"',
    connectionIds: [1, 2],
    concurrencyLimit: 5,
  };

  const mockSubTask: BatchSubTask = {
    subTaskId: 'sub-001',
    taskId: 'task-001',
    connectionId: 1,
    connectionName: 'server-1',
    command: 'echo "test"',
    status: 'queued',
    progress: 0,
  };

  const mockTask: BatchTask = {
    taskId: 'task-001',
    userId: 1,
    status: 'queued',
    concurrencyLimit: 5,
    overallProgress: 0,
    totalSubTasks: 2,
    completedSubTasks: 0,
    failedSubTasks: 0,
    cancelledSubTasks: 0,
    payload: mockPayload,
    subTasks: [mockSubTask],
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createTask', () => {
    it('应成功创建任务和子任务', async () => {
      await batchRepository.createTask(mockTask);

      expect(getDbInstance).toHaveBeenCalled();
      expect(runDb).toHaveBeenCalledTimes(2); // 1 主任务 + 1 子任务
    });

    it('应正确序列化 payload', async () => {
      await batchRepository.createTask(mockTask);

      const calls = (runDb as any).mock.calls;
      const insertTaskCall = calls[0];
      expect(insertTaskCall[1]).toContain('INSERT INTO batch_tasks');
      expect(insertTaskCall[2]).toContain(JSON.stringify(mockPayload));
    });
  });

  describe('getTask', () => {
    it('任务不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await batchRepository.getTask('non-existent');

      expect(result).toBeNull();
    });

    it('应返回包含子任务的完整任务', async () => {
      const mockTaskRow = {
        id: 'task-001',
        user_id: 1,
        status: 'queued',
        concurrency_limit: 5,
        overall_progress: 0,
        total_subtasks: 1,
        completed_subtasks: 0,
        failed_subtasks: 0,
        cancelled_subtasks: 0,
        message: null,
        payload_json: JSON.stringify(mockPayload),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        started_at: null,
        ended_at: null,
      };

      const mockSubTaskRow = {
        id: 'sub-001',
        task_id: 'task-001',
        connection_id: 1,
        connection_name: 'server-1',
        command: 'echo "test"',
        status: 'queued',
        progress: 0,
        exit_code: null,
        output: null,
        message: null,
        started_at: null,
        ended_at: null,
      };

      (getDb as any).mockResolvedValueOnce(mockTaskRow);
      (allDb as any).mockResolvedValueOnce([mockSubTaskRow]);

      const result = await batchRepository.getTask('task-001');

      expect(result).not.toBeNull();
      expect(result?.taskId).toBe('task-001');
      expect(result?.status).toBe('queued');
      expect(result?.subTasks).toHaveLength(1);
      expect(result?.subTasks[0].subTaskId).toBe('sub-001');
    });
  });

  describe('getTasksByUser', () => {
    it('应返回用户的任务列表', async () => {
      const mockTaskRow = {
        id: 'task-001',
        user_id: 1,
        status: 'completed',
        concurrency_limit: 5,
        overall_progress: 100,
        total_subtasks: 1,
        completed_subtasks: 1,
        failed_subtasks: 0,
        cancelled_subtasks: 0,
        message: null,
        payload_json: JSON.stringify(mockPayload),
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
        started_at: Math.floor(Date.now() / 1000),
        ended_at: Math.floor(Date.now() / 1000),
      };

      (allDb as any).mockResolvedValueOnce([mockTaskRow]).mockResolvedValueOnce([]);

      const result = await batchRepository.getTasksByUser(1, 20, 0);

      expect(result).toHaveLength(1);
      expect(result[0].taskId).toBe('task-001');
    });

    it('用户无任务时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await batchRepository.getTasksByUser(999);

      expect(result).toHaveLength(0);
    });
  });

  describe('updateTaskStatus', () => {
    it('应正确更新任务状态', async () => {
      await batchRepository.updateTaskStatus('task-001', 'in-progress', {
        overallProgress: 50,
        startedAt: new Date(),
      });

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE batch_tasks');
      expect(call[2]).toContain('in-progress');
    });

    it('应支持部分更新', async () => {
      await batchRepository.updateTaskStatus('task-001', 'completed', {
        overallProgress: 100,
        completedSubTasks: 5,
        endedAt: new Date(),
      });

      expect(runDb).toHaveBeenCalled();
    });
  });

  describe('updateSubTaskStatus', () => {
    it('应正确更新子任务状态', async () => {
      await batchRepository.updateSubTaskStatus('task-001', 'sub-001', 'running', 50, {
        startedAt: new Date(),
      });

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE batch_subtasks');
    });

    it('应支持输出和退出码更新', async () => {
      await batchRepository.updateSubTaskStatus('task-001', 'sub-001', 'completed', 100, {
        exitCode: 0,
        output: 'Command executed successfully',
        endedAt: new Date(),
      });

      expect(runDb).toHaveBeenCalled();
    });
  });

  describe('appendSubTaskOutput', () => {
    it('应追加输出内容', async () => {
      await batchRepository.appendSubTaskOutput('sub-001', 'new output line\n');

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[2]).toContain('new output line\n');
    });
  });

  describe('getSubTask', () => {
    it('子任务不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await batchRepository.getSubTask('task-001', 'non-existent');

      expect(result).toBeNull();
    });

    it('应返回子任务对象', async () => {
      const mockSubTaskRow = {
        id: 'sub-001',
        task_id: 'task-001',
        connection_id: 1,
        connection_name: 'server-1',
        command: 'echo "test"',
        status: 'completed',
        progress: 100,
        exit_code: 0,
        output: 'test output',
        message: null,
        started_at: Math.floor(Date.now() / 1000),
        ended_at: Math.floor(Date.now() / 1000),
      };

      (getDb as any).mockResolvedValueOnce(mockSubTaskRow);

      const result = await batchRepository.getSubTask('task-001', 'sub-001');

      expect(result).not.toBeNull();
      expect(result?.subTaskId).toBe('sub-001');
      expect(result?.exitCode).toBe(0);
    });
  });

  describe('cancelSubTasks', () => {
    it('应取消排队中的子任务', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 3 });

      const result = await batchRepository.cancelSubTasks('task-001', 'User cancelled');

      expect(result).toBe(3);
      expect(runDb).toHaveBeenCalled();
    });
  });

  describe('deleteTask', () => {
    it('应删除任务', async () => {
      await batchRepository.deleteTask('task-001');

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM batch_tasks');
    });
  });

  describe('cleanupOldTasks', () => {
    it('应清理过期任务', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 5 });

      const result = await batchRepository.cleanupOldTasks(7);

      expect(result).toBe(5);
      expect(runDb).toHaveBeenCalled();
    });

    it('无过期任务时应返回 0', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await batchRepository.cleanupOldTasks(30);

      expect(result).toBe(0);
    });
  });
});
