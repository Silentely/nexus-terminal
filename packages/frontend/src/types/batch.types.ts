/**
 * 批量作业前端类型定义
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
    command: string;
    connectionIds: number[];
    concurrencyLimit?: number;
    timeoutSeconds?: number;
    env?: Record<string, string>;
    workdir?: string;
    sudo?: boolean;
}

// 子任务
export interface BatchSubTask {
    subTaskId: string;
    taskId: string;
    connectionId: number;
    connectionName?: string;
    command: string;
    status: BatchSubTaskStatus;
    progress: number;
    exitCode?: number;
    output?: string;
    message?: string;
    startedAt?: Date;
    endedAt?: Date;
}

// 主任务
export interface BatchTask {
    taskId: string;
    userId: number | string;
    status: BatchTaskStatus;
    concurrencyLimit: number;
    overallProgress: number;
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

export interface BatchTaskListResponse {
    success: boolean;
    tasks: BatchTask[];
    total: number;
    limit: number;
    offset: number;
}

export interface BatchCancelResponse {
    success: boolean;
    taskId: string;
    message: string;
}

// WebSocket 批量事件消息
export interface BatchWsMessage {
    type: string;
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
