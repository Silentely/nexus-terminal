/**
 * 批量作业 Store
 * 管理批量命令执行、任务状态和实时进度更新
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import type {
  BatchTask,
  BatchSubTask,
  BatchExecPayload,
  BatchExecResponse,
  BatchStatusResponse,
  BatchTaskListResponse,
  BatchCancelResponse,
  BatchSubTaskStatus,
  BatchWsEventType,
} from '../types/batch.types';
import { log } from '@/utils/log';

// 输出缓冲上限（前端内存限制，防止 OOM）
const MAX_OUTPUT_SIZE = 512 * 1024; // 512KB
const TRUNCATION_NOTICE = '\n\n[输出已截断，超过 512KB 限制]';
// WS 事件超时兜底（毫秒）：若 WS 断连，超时后自动降级为轮询
const WS_TIMEOUT_MS = 10_000;

/**
 * 将 API 响应中的日期字段统一转换为 Date 对象
 */
function parseTaskDates(
  task: Omit<BatchTask, 'createdAt' | 'updatedAt' | 'subTasks'> & {
    createdAt: string | Date;
    updatedAt: string | Date;
    subTasks?: Array<
      Omit<BatchSubTask, 'startedAt' | 'endedAt'> & {
        startedAt?: string | Date;
        endedAt?: string | Date;
      }
    >;
  },
): BatchTask {
  return {
    ...task,
    createdAt: new Date(task.createdAt),
    updatedAt: new Date(task.updatedAt),
    subTasks:
      task.subTasks?.map((st) => ({
        ...st,
        startedAt: st.startedAt ? new Date(st.startedAt) : undefined,
        endedAt: st.endedAt ? new Date(st.endedAt) : undefined,
      })) || [],
  } as BatchTask;
}

export const useBatchStore = defineStore('batch', () => {
  // === State ===
  const currentTask = ref<BatchTask | null>(null);
  const tasks = ref<BatchTask[]>([]);
  const isExecuting = ref(false);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // H5: 以 taskId → connectionId 为键的状态映射，支持多任务并行
  const subTaskStatusMap = ref<Record<string, Record<number, BatchSubTaskStatus>>>({});

  // H4: WS 连接状态跟踪 — 用于轮询降级策略（ref 使其可被组件 watch）
  const wsEventReceived = ref(false);
  let wsTimeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // === Getters ===
  const hasActiveTask = computed(
    () => currentTask.value !== null && currentTask.value.status === 'in-progress',
  );
  const overallProgress = computed(() => currentTask.value?.overallProgress ?? 0);

  // === Actions ===

  /**
   * 执行批量命令
   */
  const executeBatch = async (payload: BatchExecPayload): Promise<string | null> => {
    if (isExecuting.value) return null;

    error.value = null;
    isExecuting.value = true;
    wsEventReceived.value = false;

    // 清理上一次任务的状态映射
    subTaskStatusMap.value = {};

    // 初始化子任务状态映射（H5: 以 taskId 为外层键）
    // taskId 在后端返回后才会设置，先用 'pending' 占位
    subTaskStatusMap.value['pending'] = {};
    payload.connectionIds.forEach((id) => {
      subTaskStatusMap.value['pending'][id] = 'queued';
    });

    try {
      const response = await apiClient.post<BatchExecResponse>('/batch', payload);

      if (response.data.success && response.data.task) {
        const task = parseTaskDates(response.data.task);
        currentTask.value = task;

        // 将 'pending' 键迁移到实际 taskId
        const pendingMap = subTaskStatusMap.value['pending'] || {};
        delete subTaskStatusMap.value['pending'];
        subTaskStatusMap.value[task.taskId] = pendingMap;

        // 更新子任务状态映射
        task.subTasks.forEach((st) => {
          subTaskStatusMap.value[task.taskId][st.connectionId] = st.status;
        });

        // H4: 启动 WS 超时兜底
        startWsTimeoutGuard();

        return response.data.taskId;
      }
      throw new Error(response.data.message || '执行失败');
    } catch (err: unknown) {
      log.error('[BatchStore] 执行批量命令失败:', err);
      error.value = extractErrorMessage(err, '执行批量命令失败');
      isExecuting.value = false;
      return null;
    }
  };

  /**
   * 获取任务状态
   */
  const fetchTaskStatus = async (taskId: string): Promise<BatchTask | null> => {
    try {
      const response = await apiClient.get<BatchStatusResponse>(`/batch/${taskId}`);

      if (response.data.success && response.data.task) {
        const task = parseTaskDates(response.data.task);

        // 更新当前任务
        if (currentTask.value?.taskId === taskId) {
          currentTask.value = task;
          subTaskStatusMap.value[task.taskId] = subTaskStatusMap.value[task.taskId] || {};
          task.subTasks.forEach((st) => {
            subTaskStatusMap.value[task.taskId][st.connectionId] = st.status;
          });

          // 检查是否完成
          if (['completed', 'failed', 'cancelled', 'partially-completed'].includes(task.status)) {
            isExecuting.value = false;
            clearWsTimeoutGuard();
          }
        }

        return task;
      }
      return null;
    } catch (err: unknown) {
      log.error('[BatchStore] 获取任务状态失败:', err);
      error.value = extractErrorMessage(err, '获取任务状态失败，请稍后重试');
      return null;
    }
  };

  /**
   * 获取任务列表
   */
  const fetchTaskList = async (limit = 20, offset = 0): Promise<void> => {
    isLoading.value = true;
    error.value = null;

    try {
      const response = await apiClient.get<BatchTaskListResponse>('/batch', {
        params: { limit, offset },
      });

      if (response.data.success) {
        tasks.value = response.data.tasks.map((t) =>
          parseTaskDates(t as Parameters<typeof parseTaskDates>[0]),
        );
      }
    } catch (err: unknown) {
      log.error('[BatchStore] 获取任务列表失败:', err);
      error.value = extractErrorMessage(err, '获取任务列表失败');
    } finally {
      isLoading.value = false;
    }
  };

  /**
   * 取消任务
   */
  const cancelTask = async (taskId: string): Promise<boolean> => {
    try {
      const response = await apiClient.post<BatchCancelResponse>(`/batch/${taskId}/cancel`);

      if (response.data.success) {
        // 刷新任务状态
        await fetchTaskStatus(taskId);
        return true;
      }
      return false;
    } catch (err: unknown) {
      log.error('[BatchStore] 取消任务失败:', err);
      error.value = extractErrorMessage(err, '取消任务失败');
      return false;
    }
  };

  /**
   * 删除任务
   */
  const deleteTask = async (taskId: string): Promise<boolean> => {
    try {
      await apiClient.delete(`/batch/${taskId}`);

      // 从本地列表移除
      tasks.value = tasks.value.filter((t) => t.taskId !== taskId);

      // 如果删除的是当前任务，清空状态
      if (currentTask.value?.taskId === taskId) {
        currentTask.value = null;
        isExecuting.value = false;
        clearWsTimeoutGuard();
      }

      // 清理状态映射
      delete subTaskStatusMap.value[taskId];

      return true;
    } catch (err: unknown) {
      log.error('[BatchStore] 删除任务失败:', err);
      error.value = extractErrorMessage(err, '删除任务失败');
      return false;
    }
  };

  /**
   * H4: WS 超时兜底 — 收到首个 WS 事件后停止轮询计时器
   */
  const onWsEventReceived = (): void => {
    wsEventReceived.value = true;
    clearWsTimeoutGuard();
  };

  /**
   * H4: 启动 WS 超时守卫 — 超时后由轮询兜底
   */
  const startWsTimeoutGuard = (): void => {
    clearWsTimeoutGuard();
    wsEventReceived.value = false;
    wsTimeoutTimer = setTimeout(() => {
      if (!wsEventReceived.value && isExecuting.value) {
        log.warn('[BatchStore] WS 事件超时，轮询将作为降级方案继续工作。');
      }
    }, WS_TIMEOUT_MS);
  };

  const clearWsTimeoutGuard = (): void => {
    if (wsTimeoutTimer) {
      clearTimeout(wsTimeoutTimer);
      wsTimeoutTimer = null;
    }
  };

  /**
   * 处理 WebSocket 批量事件
   */
  const handleBatchWsEvent = (type: BatchWsEventType | string, payload: unknown): void => {
    const eventPayload = payload as {
      taskId?: string;
      subTaskId?: string;
      status?: BatchSubTaskStatus | BatchTask['status'];
      progress?: number;
      output?: string;
      exitCode?: number;
      message?: string;
      overallProgress?: number;
      completed?: number;
      failed?: number;
      chunk?: string;
    };

    if (!currentTask.value || currentTask.value.taskId !== eventPayload.taskId) return;

    // H4: 标记收到 WS 事件，停止超时守卫
    onWsEventReceived();

    const taskId = currentTask.value.taskId;

    switch (type) {
      case 'batch:subtask:update': {
        // 更新子任务状态
        if (eventPayload.subTaskId) {
          const subTask = currentTask.value.subTasks.find(
            (st) => st.subTaskId === eventPayload.subTaskId,
          );
          if (subTask) {
            if (eventPayload.status) subTask.status = eventPayload.status as BatchSubTaskStatus;
            if (eventPayload.progress !== undefined) subTask.progress = eventPayload.progress;
            if (eventPayload.output !== undefined) subTask.output = eventPayload.output;
            if (eventPayload.exitCode !== undefined) subTask.exitCode = eventPayload.exitCode;
            if (eventPayload.message) subTask.message = eventPayload.message;

            // H5: 更新状态映射（taskId 嵌套键）
            if (!subTaskStatusMap.value[taskId]) subTaskStatusMap.value[taskId] = {};
            subTaskStatusMap.value[taskId][subTask.connectionId] = subTask.status;
          }
        }
        break;
      }

      case 'batch:overall':
        // 更新整体进度
        if (eventPayload.status)
          currentTask.value.status = eventPayload.status as BatchTask['status'];
        if (eventPayload.overallProgress !== undefined)
          currentTask.value.overallProgress = eventPayload.overallProgress;
        if (eventPayload.completed !== undefined)
          currentTask.value.completedSubTasks = eventPayload.completed;
        if (eventPayload.failed !== undefined)
          currentTask.value.failedSubTasks = eventPayload.failed;
        break;

      case 'batch:completed':
      case 'batch:failed':
      case 'batch:cancelled': {
        // 任务结束
        isExecuting.value = false;
        clearWsTimeoutGuard();
        // 刷新最终状态
        if (eventPayload.taskId) {
          fetchTaskStatus(eventPayload.taskId);
        }
        break;
      }

      case 'batch:log': {
        // H3: 流式输出，带上限截断（预留截断提示空间）
        if (eventPayload.subTaskId && eventPayload.chunk) {
          const subTask = currentTask.value.subTasks.find(
            (st) => st.subTaskId === eventPayload.subTaskId,
          );
          if (subTask && !subTask.output?.endsWith(TRUNCATION_NOTICE)) {
            const currentOutput = subTask.output || '';
            if (currentOutput.length < MAX_OUTPUT_SIZE) {
              const budget = Math.max(
                0,
                MAX_OUTPUT_SIZE - currentOutput.length - TRUNCATION_NOTICE.length,
              );
              if (budget > 0) {
                const chunk = eventPayload.chunk.substring(0, budget);
                subTask.output = currentOutput + chunk;
              }
              // budget=0 空间耗尽，或原始 chunk 超出预算时，均追加截断提示
              if (
                budget === 0 ||
                currentOutput.length + eventPayload.chunk.length >= MAX_OUTPUT_SIZE
              ) {
                subTask.output = (subTask.output || currentOutput) + TRUNCATION_NOTICE;
              }
            }
          }
        }
        break;
      }
    }
  };

  /**
   * 获取连接的执行状态（H5: 需要 taskId）
   */
  const getConnectionStatus = (
    connectionId: number,
    taskId?: string,
  ): BatchSubTaskStatus | null => {
    const effectiveTaskId = taskId || currentTask.value?.taskId;
    if (!effectiveTaskId) return null;
    return subTaskStatusMap.value[effectiveTaskId]?.[connectionId] || null;
  };

  /**
   * 获取连接的子任务
   */
  const getSubTaskByConnection = (connectionId: number): BatchSubTask | null => {
    if (!currentTask.value) return null;
    return currentTask.value.subTasks.find((st) => st.connectionId === connectionId) || null;
  };

  /**
   * 重置状态
   */
  const reset = (): void => {
    currentTask.value = null;
    isExecuting.value = false;
    error.value = null;
    subTaskStatusMap.value = {};
    clearWsTimeoutGuard();
  };

  /**
   * 清除错误
   */
  const clearError = (): void => {
    error.value = null;
  };

  return {
    // State
    currentTask,
    tasks,
    isExecuting,
    isLoading,
    error,
    subTaskStatusMap,
    wsEventReceived,

    // Getters
    hasActiveTask,
    overallProgress,

    // Actions
    executeBatch,
    fetchTaskStatus,
    fetchTaskList,
    cancelTask,
    deleteTask,
    handleBatchWsEvent,
    getConnectionStatus,
    getSubTaskByConnection,
    reset,
    clearError,
  };
});
