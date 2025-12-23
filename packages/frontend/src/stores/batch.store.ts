/**
 * 批量作业 Store
 * 管理批量命令执行、任务状态和实时进度更新
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import apiClient from '../utils/apiClient';
import type {
  BatchTask,
  BatchSubTask,
  BatchExecPayload,
  BatchExecResponse,
  BatchStatusResponse,
  BatchTaskListResponse,
  BatchCancelResponse,
  BatchSubTaskStatus,
} from '../types/batch.types';

export const useBatchStore = defineStore('batch', () => {
  // === State ===
  const currentTask = ref<BatchTask | null>(null);
  const tasks = ref<BatchTask[]>([]);
  const isExecuting = ref(false);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // 子任务状态映射（用于快速查询）
  const subTaskStatusMap = ref<Record<number, BatchSubTaskStatus>>({});

  // === Getters ===
  const hasActiveTask = computed(
    () => currentTask.value !== null && currentTask.value.status === 'in-progress'
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

    // 清理上一次任务的状态映射
    subTaskStatusMap.value = {};

    // 初始化子任务状态
    payload.connectionIds.forEach((id) => {
      subTaskStatusMap.value[id] = 'queued';
    });

    try {
      const response = await apiClient.post<BatchExecResponse>('/batch', payload);

      if (response.data.success && response.data.task) {
        currentTask.value = {
          ...response.data.task,
          createdAt: new Date(response.data.task.createdAt),
          updatedAt: new Date(response.data.task.updatedAt),
          subTasks: response.data.task.subTasks.map((st) => ({
            ...st,
            startedAt: st.startedAt ? new Date(st.startedAt) : undefined,
            endedAt: st.endedAt ? new Date(st.endedAt) : undefined,
          })),
        };

        // 更新子任务状态映射
        currentTask.value.subTasks.forEach((st) => {
          subTaskStatusMap.value[st.connectionId] = st.status;
        });

        return response.data.taskId;
      }
      throw new Error(response.data.message || '执行失败');
    } catch (err: any) {
      console.error('[BatchStore] 执行批量命令失败:', err);
      error.value = err.response?.data?.message || '执行批量命令失败';
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
        const task: BatchTask = {
          ...response.data.task,
          createdAt: new Date(response.data.task.createdAt),
          updatedAt: new Date(response.data.task.updatedAt),
          subTasks: response.data.task.subTasks.map((st) => ({
            ...st,
            startedAt: st.startedAt ? new Date(st.startedAt) : undefined,
            endedAt: st.endedAt ? new Date(st.endedAt) : undefined,
          })),
        };

        // 更新当前任务
        if (currentTask.value?.taskId === taskId) {
          currentTask.value = task;
          task.subTasks.forEach((st) => {
            subTaskStatusMap.value[st.connectionId] = st.status;
          });

          // 检查是否完成
          if (['completed', 'failed', 'cancelled', 'partially-completed'].includes(task.status)) {
            isExecuting.value = false;
          }
        }

        return task;
      }
      return null;
    } catch (err: any) {
      console.error('[BatchStore] 获取任务状态失败:', err);
      // 设置错误状态，但不直接释放 isExecuting（任务可能仍在执行，只是查询失败）
      error.value = err.response?.data?.message || '获取任务状态失败，请稍后重试';
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
        tasks.value = response.data.tasks.map((t) => ({
          ...t,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
          subTasks:
            t.subTasks?.map((st) => ({
              ...st,
              startedAt: st.startedAt ? new Date(st.startedAt) : undefined,
              endedAt: st.endedAt ? new Date(st.endedAt) : undefined,
            })) || [],
        }));
      }
    } catch (err: any) {
      console.error('[BatchStore] 获取任务列表失败:', err);
      error.value = err.response?.data?.message || '获取任务列表失败';
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
    } catch (err: any) {
      console.error('[BatchStore] 取消任务失败:', err);
      error.value = err.response?.data?.message || '取消任务失败';
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
      }

      return true;
    } catch (err: any) {
      console.error('[BatchStore] 删除任务失败:', err);
      error.value = err.response?.data?.message || '删除任务失败';
      return false;
    }
  };

  /**
   * 处理 WebSocket 批量事件
   */
  const handleBatchWsEvent = (type: string, payload: any): void => {
    if (!currentTask.value || currentTask.value.taskId !== payload.taskId) return;

    switch (type) {
      case 'batch:subtask:update':
        // 更新子任务状态
        if (payload.subTaskId) {
          const subTask = currentTask.value.subTasks.find(
            (st) => st.subTaskId === payload.subTaskId
          );
          if (subTask) {
            if (payload.status) subTask.status = payload.status;
            if (payload.progress !== undefined) subTask.progress = payload.progress;
            if (payload.output !== undefined) subTask.output = payload.output;
            if (payload.exitCode !== undefined) subTask.exitCode = payload.exitCode;
            if (payload.message) subTask.message = payload.message;

            // 更新状态映射
            subTaskStatusMap.value[subTask.connectionId] = subTask.status;
          }
        }
        break;

      case 'batch:overall':
        // 更新整体进度
        if (payload.status) currentTask.value.status = payload.status;
        if (payload.overallProgress !== undefined)
          currentTask.value.overallProgress = payload.overallProgress;
        if (payload.completed !== undefined)
          currentTask.value.completedSubTasks = payload.completed;
        if (payload.failed !== undefined) currentTask.value.failedSubTasks = payload.failed;
        break;

      case 'batch:completed':
      case 'batch:failed':
      case 'batch:cancelled':
        // 任务结束
        isExecuting.value = false;
        // 刷新最终状态
        fetchTaskStatus(payload.taskId);
        break;

      case 'batch:log':
        // 流式输出
        if (payload.subTaskId && payload.chunk) {
          const subTask = currentTask.value.subTasks.find(
            (st) => st.subTaskId === payload.subTaskId
          );
          if (subTask) {
            subTask.output = (subTask.output || '') + payload.chunk;
          }
        }
        break;
    }
  };

  /**
   * 获取连接的执行状态
   */
  const getConnectionStatus = (connectionId: number): BatchSubTaskStatus | null => {
    return subTaskStatusMap.value[connectionId] || null;
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
