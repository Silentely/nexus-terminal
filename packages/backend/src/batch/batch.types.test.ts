/**
 * Batch Types 单元测试
 */
import { describe, it, expect } from 'vitest';
import type {
    BatchTaskStatus,
    BatchSubTaskStatus,
    BatchExecPayload,
    BatchSubTask,
    BatchTask,
    BatchWsEventType,
} from './batch.types';

describe('Batch Types', () => {
    describe('BatchTaskStatus', () => {
        it('应定义所有有效的任务状态', () => {
            const validStatuses: BatchTaskStatus[] = [
                'queued',
                'in-progress',
                'partially-completed',
                'completed',
                'failed',
                'cancelled',
            ];
            expect(validStatuses.length).toBe(6);
        });
    });

    describe('BatchSubTaskStatus', () => {
        it('应定义所有有效的子任务状态', () => {
            const validStatuses: BatchSubTaskStatus[] = [
                'queued',
                'connecting',
                'running',
                'completed',
                'failed',
                'cancelled',
            ];
            expect(validStatuses.length).toBe(6);
        });
    });

    describe('BatchExecPayload', () => {
        it('应正确创建基本执行负载', () => {
            const payload: BatchExecPayload = {
                command: 'echo "test"',
                connectionIds: [1, 2, 3],
            };
            expect(payload.command).toBe('echo "test"');
            expect(payload.connectionIds).toHaveLength(3);
            expect(payload.concurrencyLimit).toBeUndefined();
        });

        it('应支持可选参数', () => {
            const payload: BatchExecPayload = {
                command: 'apt update',
                connectionIds: [1],
                concurrencyLimit: 5,
                timeoutSeconds: 300,
                env: { PATH: '/usr/bin' },
                workdir: '/tmp',
                sudo: true,
            };
            expect(payload.concurrencyLimit).toBe(5);
            expect(payload.timeoutSeconds).toBe(300);
            expect(payload.env?.PATH).toBe('/usr/bin');
            expect(payload.workdir).toBe('/tmp');
            expect(payload.sudo).toBe(true);
        });
    });

    describe('BatchSubTask', () => {
        it('应正确创建子任务对象', () => {
            const subTask: BatchSubTask = {
                subTaskId: 'sub-123',
                taskId: 'task-456',
                connectionId: 1,
                connectionName: 'test-server',
                command: 'ls -la',
                status: 'queued',
                progress: 0,
            };
            expect(subTask.subTaskId).toBe('sub-123');
            expect(subTask.taskId).toBe('task-456');
            expect(subTask.status).toBe('queued');
            expect(subTask.progress).toBe(0);
        });

        it('应支持完成状态的可选字段', () => {
            const subTask: BatchSubTask = {
                subTaskId: 'sub-123',
                taskId: 'task-456',
                connectionId: 1,
                command: 'exit 0',
                status: 'completed',
                progress: 100,
                exitCode: 0,
                output: 'success',
                message: 'Completed successfully',
                startedAt: new Date('2025-01-01T00:00:00Z'),
                endedAt: new Date('2025-01-01T00:00:05Z'),
            };
            expect(subTask.exitCode).toBe(0);
            expect(subTask.output).toBe('success');
            expect(subTask.endedAt).toBeInstanceOf(Date);
        });
    });

    describe('BatchTask', () => {
        it('应正确创建主任务对象', () => {
            const task: BatchTask = {
                taskId: 'task-123',
                userId: 1,
                status: 'queued',
                concurrencyLimit: 5,
                overallProgress: 0,
                totalSubTasks: 3,
                completedSubTasks: 0,
                failedSubTasks: 0,
                cancelledSubTasks: 0,
                payload: {
                    command: 'uptime',
                    connectionIds: [1, 2, 3],
                },
                subTasks: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            expect(task.taskId).toBe('task-123');
            expect(task.status).toBe('queued');
            expect(task.totalSubTasks).toBe(3);
            expect(task.subTasks).toHaveLength(0);
        });

        it('应正确计算任务进度', () => {
            const task: BatchTask = {
                taskId: 'task-123',
                userId: 1,
                status: 'partially-completed',
                concurrencyLimit: 5,
                overallProgress: 67,
                totalSubTasks: 3,
                completedSubTasks: 2,
                failedSubTasks: 0,
                cancelledSubTasks: 0,
                payload: { command: 'test', connectionIds: [1, 2, 3] },
                subTasks: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            expect(task.overallProgress).toBe(67);
            expect(task.completedSubTasks).toBe(2);
        });
    });

    describe('BatchWsEventType', () => {
        it('应定义所有有效的 WebSocket 事件类型', () => {
            const validEvents: BatchWsEventType[] = [
                'batch:started',
                'batch:subtask:update',
                'batch:overall',
                'batch:completed',
                'batch:failed',
                'batch:cancelled',
                'batch:log',
            ];
            expect(validEvents.length).toBe(7);
        });
    });
});
