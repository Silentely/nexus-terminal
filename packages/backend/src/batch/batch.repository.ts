/**
 * 批量作业 Repository 层
 * 处理批量任务和子任务的数据库操作
 */

import { getDbInstance, runDb, allDb, getDb } from '../database/connection';
import {
    BatchTask,
    BatchSubTask,
    BatchTaskStatus,
    BatchSubTaskStatus,
    BatchTaskRow,
    BatchSubTaskRow,
    BatchExecPayload
} from './batch.types';

// 行数据转换为 BatchTask 对象
const rowToTask = (row: BatchTaskRow, subTasks: BatchSubTask[] = []): BatchTask => ({
    taskId: row.id,
    userId: row.user_id,
    status: row.status,
    concurrencyLimit: row.concurrency_limit,
    overallProgress: row.overall_progress,
    totalSubTasks: row.total_subtasks,
    completedSubTasks: row.completed_subtasks,
    failedSubTasks: row.failed_subtasks,
    cancelledSubTasks: row.cancelled_subtasks,
    message: row.message || undefined,
    payload: JSON.parse(row.payload_json) as BatchExecPayload,
    subTasks,
    createdAt: new Date(row.created_at * 1000),
    updatedAt: new Date(row.updated_at * 1000),
    startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
    endedAt: row.ended_at ? new Date(row.ended_at * 1000) : undefined,
});

// 行数据转换为 BatchSubTask 对象
const rowToSubTask = (row: BatchSubTaskRow): BatchSubTask => ({
    subTaskId: row.id,
    taskId: row.task_id,
    connectionId: row.connection_id,
    connectionName: row.connection_name || undefined,
    command: row.command,
    status: row.status,
    progress: row.progress,
    exitCode: row.exit_code ?? undefined,
    output: row.output || undefined,
    message: row.message || undefined,
    startedAt: row.started_at ? new Date(row.started_at * 1000) : undefined,
    endedAt: row.ended_at ? new Date(row.ended_at * 1000) : undefined,
});

/**
 * 创建批量任务
 */
export const createTask = async (task: BatchTask): Promise<void> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);

    // 插入主任务
    await runDb(db, `
        INSERT INTO batch_tasks (
            id, user_id, status, concurrency_limit, overall_progress,
            total_subtasks, completed_subtasks, failed_subtasks, cancelled_subtasks,
            message, payload_json, created_at, updated_at, started_at, ended_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        task.taskId,
        task.userId,
        task.status,
        task.concurrencyLimit,
        task.overallProgress,
        task.totalSubTasks,
        task.completedSubTasks,
        task.failedSubTasks,
        task.cancelledSubTasks,
        task.message || null,
        JSON.stringify(task.payload),
        now,
        now,
        task.startedAt ? Math.floor(task.startedAt.getTime() / 1000) : null,
        task.endedAt ? Math.floor(task.endedAt.getTime() / 1000) : null
    ]);

    // 批量插入子任务
    for (const subTask of task.subTasks) {
        await runDb(db, `
            INSERT INTO batch_subtasks (
                id, task_id, connection_id, connection_name, command,
                status, progress, exit_code, output, message, started_at, ended_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
            subTask.subTaskId,
            task.taskId,
            subTask.connectionId,
            subTask.connectionName || null,
            subTask.command,
            subTask.status,
            subTask.progress,
            subTask.exitCode ?? null,
            subTask.output || null,
            subTask.message || null,
            subTask.startedAt ? Math.floor(subTask.startedAt.getTime() / 1000) : null,
            subTask.endedAt ? Math.floor(subTask.endedAt.getTime() / 1000) : null
        ]);
    }
};

/**
 * 获取批量任务（包含子任务）
 */
export const getTask = async (taskId: string): Promise<BatchTask | null> => {
    const db = await getDbInstance();
    const taskRow = await getDb<BatchTaskRow>(db, `
        SELECT * FROM batch_tasks WHERE id = ?
    `, [taskId]);

    if (!taskRow) return null;

    const subTaskRows = await allDb<BatchSubTaskRow>(db, `
        SELECT * FROM batch_subtasks WHERE task_id = ? ORDER BY started_at ASC
    `, [taskId]);

    const subTasks = subTaskRows.map(rowToSubTask);
    return rowToTask(taskRow, subTasks);
};

/**
 * 获取用户的批量任务列表
 */
export const getTasksByUser = async (
    userId: number | string,
    limit: number = 20,
    offset: number = 0
): Promise<BatchTask[]> => {
    const db = await getDbInstance();
    const taskRows = await allDb<BatchTaskRow>(db, `
        SELECT * FROM batch_tasks
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    const tasks: BatchTask[] = [];
    for (const row of taskRows) {
        const subTaskRows = await allDb<BatchSubTaskRow>(db, `
            SELECT * FROM batch_subtasks WHERE task_id = ?
        `, [row.id]);
        tasks.push(rowToTask(row, subTaskRows.map(rowToSubTask)));
    }

    return tasks;
};

/**
 * 更新任务状态
 */
export const updateTaskStatus = async (
    taskId: string,
    status: BatchTaskStatus,
    updates: Partial<{
        overallProgress: number;
        completedSubTasks: number;
        failedSubTasks: number;
        cancelledSubTasks: number;
        message: string;
        startedAt: Date;
        endedAt: Date;
    }> = {}
): Promise<void> => {
    const db = await getDbInstance();
    const now = Math.floor(Date.now() / 1000);
    const setClauses: string[] = ['status = ?', 'updated_at = ?'];
    const values: any[] = [status, now];

    if (updates.overallProgress !== undefined) {
        setClauses.push('overall_progress = ?');
        values.push(updates.overallProgress);
    }
    if (updates.completedSubTasks !== undefined) {
        setClauses.push('completed_subtasks = ?');
        values.push(updates.completedSubTasks);
    }
    if (updates.failedSubTasks !== undefined) {
        setClauses.push('failed_subtasks = ?');
        values.push(updates.failedSubTasks);
    }
    if (updates.cancelledSubTasks !== undefined) {
        setClauses.push('cancelled_subtasks = ?');
        values.push(updates.cancelledSubTasks);
    }
    if (updates.message !== undefined) {
        setClauses.push('message = ?');
        values.push(updates.message);
    }
    if (updates.startedAt) {
        setClauses.push('started_at = ?');
        values.push(Math.floor(updates.startedAt.getTime() / 1000));
    }
    if (updates.endedAt) {
        setClauses.push('ended_at = ?');
        values.push(Math.floor(updates.endedAt.getTime() / 1000));
    }

    values.push(taskId);

    await runDb(db, `
        UPDATE batch_tasks SET ${setClauses.join(', ')} WHERE id = ?
    `, values);
};

/**
 * 更新子任务状态
 */
export const updateSubTaskStatus = async (
    taskId: string,
    subTaskId: string,
    status: BatchSubTaskStatus,
    progress: number,
    updates: Partial<{
        exitCode: number;
        output: string;
        message: string;
        startedAt: Date;
        endedAt: Date;
    }> = {}
): Promise<void> => {
    const db = await getDbInstance();
    const setClauses: string[] = ['status = ?', 'progress = ?'];
    const values: any[] = [status, progress];

    if (updates.exitCode !== undefined) {
        setClauses.push('exit_code = ?');
        values.push(updates.exitCode);
    }
    if (updates.output !== undefined) {
        setClauses.push('output = ?');
        values.push(updates.output);
    }
    if (updates.message !== undefined) {
        setClauses.push('message = ?');
        values.push(updates.message);
    }
    if (updates.startedAt) {
        setClauses.push('started_at = ?');
        values.push(Math.floor(updates.startedAt.getTime() / 1000));
    }
    if (updates.endedAt) {
        setClauses.push('ended_at = ?');
        values.push(Math.floor(updates.endedAt.getTime() / 1000));
    }

    values.push(subTaskId);

    await runDb(db, `
        UPDATE batch_subtasks SET ${setClauses.join(', ')} WHERE id = ?
    `, values);
};

/**
 * 追加子任务输出（用于流式日志）
 */
export const appendSubTaskOutput = async (
    subTaskId: string,
    chunk: string
): Promise<void> => {
    const db = await getDbInstance();
    await runDb(db, `
        UPDATE batch_subtasks SET output = COALESCE(output, '') || ? WHERE id = ?
    `, [chunk, subTaskId]);
};

/**
 * 获取子任务
 */
export const getSubTask = async (
    taskId: string,
    subTaskId: string
): Promise<BatchSubTask | null> => {
    const db = await getDbInstance();
    const row = await getDb<BatchSubTaskRow>(db, `
        SELECT * FROM batch_subtasks WHERE id = ? AND task_id = ?
    `, [subTaskId, taskId]);

    return row ? rowToSubTask(row) : null;
};

/**
 * 批量取消子任务
 */
export const cancelSubTasks = async (
    taskId: string,
    reason: string = 'Cancelled by user'
): Promise<number> => {
    const db = await getDbInstance();
    const result = await runDb(db, `
        UPDATE batch_subtasks
        SET status = 'cancelled', message = ?
        WHERE task_id = ? AND status IN ('queued', 'connecting')
    `, [reason, taskId]);

    return (result as any).changes || 0;
};

/**
 * 删除任务及其子任务
 */
export const deleteTask = async (taskId: string): Promise<void> => {
    const db = await getDbInstance();
    await runDb(db, 'DELETE FROM batch_tasks WHERE id = ?', [taskId]);
};

/**
 * 清理过期任务（用于定期清理）
 */
export const cleanupOldTasks = async (daysOld: number = 7): Promise<number> => {
    const db = await getDbInstance();
    const cutoff = Math.floor(Date.now() / 1000) - (daysOld * 24 * 60 * 60);
    const result = await runDb(db, `
        DELETE FROM batch_tasks
        WHERE ended_at IS NOT NULL AND ended_at < ?
    `, [cutoff]);

    return (result as any).changes || 0;
};
