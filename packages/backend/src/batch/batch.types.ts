/**
 * 批量作业模块类型定义
 * @module batch/batch.types
 */

// 批量任务状态
export type BatchTaskStatus =
    | 'queued'              // 排队中
    | 'in-progress'         // 执行中
    | 'partially-completed' // 部分完成
    | 'completed'           // 全部完成
    | 'failed'              // 失败
    | 'cancelled';          // 已取消

// 子任务状态
export type BatchSubTaskStatus =
    | 'queued'      // 排队中
    | 'connecting'  // 连接中
    | 'running'     // 运行中
    | 'completed'   // 完成
    | 'failed'      // 失败
    | 'cancelled';  // 已取消

// 批量执行请求参数
export interface BatchExecPayload {
    command: string;                    // 要执行的命令
    connectionIds: number[];            // 目标服务器连接 ID 列表
    concurrencyLimit?: number;          // 并发限制（默认 5）
    timeoutSeconds?: number;            // 单主机执行超时（秒）
    env?: Record<string, string>;       // 可选环境变量
    workdir?: string;                   // 远端工作目录
    sudo?: boolean;                     // 是否 sudo 执行
}

// 子任务
export interface BatchSubTask {
    subTaskId: string;
    taskId: string;
    connectionId: number;
    connectionName?: string;            // 连接名称（用于显示）
    command: string;
    status: BatchSubTaskStatus;
    progress: number;                   // 0-100
    exitCode?: number;
    output?: string;                    // stdout + stderr 合并
    message?: string;                   // 失败/提示信息
    startedAt?: Date;
    endedAt?: Date;
}

// 主任务
export interface BatchTask {
    taskId: string;
    userId: number | string;
    status: BatchTaskStatus;
    concurrencyLimit: number;
    overallProgress: number;            // 0-100
    totalSubTasks: number;
    completedSubTasks: number;
    failedSubTasks: number;
    cancelledSubTasks: number;
    message?: string;
    payload: BatchExecPayload;
    subTasks: BatchSubTask[];
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    endedAt?: Date;
}

// WebSocket 事件类型
export type BatchWsEventType =
    | 'batch:started'           // { taskId, total, concurrency }
    | 'batch:subtask:update'    // { taskId, subTaskId, status, progress, message?, output?, exitCode? }
    | 'batch:overall'           // { taskId, status, overallProgress, completed, failed }
    | 'batch:completed'         // { taskId, overallProgress: 100 }
    | 'batch:failed'            // { taskId, reason }
    | 'batch:cancelled'         // { taskId, reason }
    | 'batch:log';              // 流式输出 { taskId, subTaskId, chunk }

// WebSocket 批量事件消息
export interface BatchWsMessage {
    type: BatchWsEventType;
    payload: {
        taskId: string;
        subTaskId?: string;
        status?: BatchTaskStatus | BatchSubTaskStatus;
        progress?: number;
        overallProgress?: number;
        total?: number;
        completed?: number;
        failed?: number;
        cancelled?: number;
        concurrency?: number;
        message?: string;
        reason?: string;
        output?: string;
        exitCode?: number;
        chunk?: string;
    };
}

// API 响应类型
export interface BatchExecResponse {
    success: boolean;
    taskId: string;
    message: string;
    task?: BatchTask;
}

export interface BatchStatusResponse {
    success: boolean;
    task?: BatchTask;
    message?: string;
}

export interface BatchCancelResponse {
    success: boolean;
    taskId: string;
    message: string;
}

// 数据库存储格式（SQLite）
export interface BatchTaskRow {
    id: string;
    user_id: number;
    status: BatchTaskStatus;
    concurrency_limit: number;
    overall_progress: number;
    total_subtasks: number;
    completed_subtasks: number;
    failed_subtasks: number;
    cancelled_subtasks: number;
    message: string | null;
    payload_json: string;
    created_at: number;
    updated_at: number;
    started_at: number | null;
    ended_at: number | null;
}

export interface BatchSubTaskRow {
    id: string;
    task_id: string;
    connection_id: number;
    connection_name: string | null;
    command: string;
    status: BatchSubTaskStatus;
    progress: number;
    exit_code: number | null;
    output: string | null;
    message: string | null;
    started_at: number | null;
    ended_at: number | null;
}
