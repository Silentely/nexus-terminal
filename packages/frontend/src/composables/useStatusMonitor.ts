import { ref, readonly, watch, type Ref, ComputedRef } from 'vue'; // 修正导入，移除大写 Readonly, 添加 watch
// import { useWebSocketConnection } from './useWebSocketConnection'; // 移除全局导入
import type { ServerStatus } from '../types/server.types';
import type { WebSocketMessage, MessagePayload } from '../types/websocket.types';
import { useLayoutStore } from '../stores/layout.store';

// 定义与 WebSocket 相关的依赖接口
export interface StatusMonitorDependencies {
  onMessage: (
    type: string,
    handler: (payload: any, fullMessage?: WebSocketMessage) => void
  ) => () => void;
  isConnected: ComputedRef<boolean>;
}

/**
 * 创建一个状态监控管理器实例
 * @param sessionId 会话唯一标识符
 * @param wsDeps WebSocket 依赖对象
 * @returns 状态监控管理器实例
 */
export function createStatusMonitorManager(sessionId: string, wsDeps: StatusMonitorDependencies) {
  const { onMessage, isConnected } = wsDeps;
  const MAX_HISTORY_POINTS = 60; // 图表显示的点数

  const serverStatus = ref<ServerStatus | null>(null);
  const statusError = ref<string | null>(null); // 存储状态获取错误

  // --- 历史数据存储 ---
  // 初始化为包含60个 null 或 0 的数组，这样图表初始时有占位
  const cpuHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null));
  const memUsedHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null)); // Store memUsed in MB
  const netRxHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null)); // Store rate in Bytes/sec
  const netTxHistory = ref<(number | null)[]>(Array(MAX_HISTORY_POINTS).fill(null)); // Store rate in Bytes/sec

  // --- 辅助函数：更新历史数据数组 ---
  const updateHistory = (historyRef: Ref<(number | null)[]>, newValue: number | undefined) => {
    const currentHistory = historyRef.value;
    currentHistory.shift(); // 移除最旧的数据点
    // 如果新值无效（undefined 或 null），推入 null，否则推入数字
    currentHistory.push(
      newValue === undefined || newValue === null || isNaN(newValue) ? null : newValue
    );
    historyRef.value = [...currentHistory]; // 触发响应式更新
  };

  // --- WebSocket 消息处理 ---
  const handleStatusUpdate = (payload: MessagePayload, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    // console.debug(`[会话 ${sessionId}][状态监控模块] 收到 status_update:`, JSON.stringify(payload));
    if (payload?.status) {
      const newStatus: ServerStatus = payload.status;
      serverStatus.value = newStatus;
      statusError.value = null; // 收到有效状态时清除错误

      // 更新历史数据
      updateHistory(cpuHistory, newStatus.cpuPercent);
      updateHistory(memUsedHistory, newStatus.memUsed);
      updateHistory(netRxHistory, newStatus.netRxRate);
      updateHistory(netTxHistory, newStatus.netTxRate);
    } else {
      console.warn(`[会话 ${sessionId}][状态监控模块] 收到无效的 status_update 消息`);
      // 可以选择设置一个错误状态，表明数据格式不正确
      // statusError.value = '收到的状态数据格式无效';
    }
  };

  // 处理可能的后端状态错误消息 (如果后端会发送的话)
  const handleStatusError = (payload: MessagePayload, message?: WebSocketMessage) => {
    // 检查消息是否属于此会话
    if (message?.sessionId && message.sessionId !== sessionId) {
      return; // 忽略不属于此会话的消息
    }

    console.error(`[会话 ${sessionId}][状态监控模块] 收到状态错误消息:`, payload);
    statusError.value = typeof payload === 'string' ? payload : '获取服务器状态时发生未知错误';
    serverStatus.value = null; // 出错时清除状态数据
  };

  // --- 注册 WebSocket 消息处理器 ---
  let unregisterUpdate: (() => void) | null = null;
  let unregisterError: (() => void) | null = null;

  const registerStatusHandlers = () => {
    // 防止重复注册
    if (unregisterUpdate || unregisterError) {
      console.log(`[会话 ${sessionId}][状态监控模块] 处理器已注册，跳过。`);
      return;
    }
    if (isConnected.value) {
      console.log(`[会话 ${sessionId}][状态监控模块] 注册状态消息处理器。`);
      unregisterUpdate = onMessage('status_update', handleStatusUpdate);
      unregisterError = onMessage('status:error', handleStatusError);
    } else {
      console.warn(`[会话 ${sessionId}][状态监控模块] WebSocket 未连接，无法注册状态处理器。`);
    }
  };

  const unregisterAllStatusHandlers = () => {
    if (unregisterUpdate || unregisterError) {
      console.log(`[会话 ${sessionId}][状态监控模块] 注销状态消息处理器。`);
      unregisterUpdate?.();
      unregisterError?.();
      unregisterUpdate = null;
      unregisterError = null;
    }
  };

  // 监听连接状态变化以自动注册/注销处理器
  watch(isConnected, (newValue, oldValue) => {
    console.log(`[会话 ${sessionId}][状态监控模块] 连接状态变化: ${oldValue} -> ${newValue}`);
    if (newValue) {
      // 只有当状态监视器在布局中时才注册处理器
      const layoutStore = useLayoutStore();
      if (layoutStore.usedPanes.has('statusMonitor')) {
        registerStatusHandlers();
        // 连接成功后，可以考虑请求一次初始状态（如果后端支持）
        // sendMessage({ type: 'status:update', sessionId });
      } else {
        console.log(`[会话 ${sessionId}][状态监控模块] 状态监视器不在布局中，跳过注册处理器。`);
      }
    } else {
      unregisterAllStatusHandlers();
      // 连接断开时清除状态
      serverStatus.value = null;
      // 只有在之前连接成功的情况下才设置断开错误
      if (oldValue === true) {
        statusError.value = '连接已断开'; // 或者使用 i18n
      }
    }
  }); // 移除 immediate: true，避免初始设置错误状态

  // --- 清理函数 ---
  const cleanup = () => {
    unregisterAllStatusHandlers();
    console.log(`[会话 ${sessionId}][状态监控模块] 已清理。`);
  };

  // --- 暴露接口 ---
  return {
    serverStatus: readonly(serverStatus), // 当前状态
    statusError: readonly(statusError), // 错误状态
    // --- 暴露历史数据 ---
    cpuHistory: readonly(cpuHistory),
    memUsedHistory: readonly(memUsedHistory),
    netRxHistory: readonly(netRxHistory),
    netTxHistory: readonly(netTxHistory),
    // --- 控制函数 ---
    registerStatusHandlers,
    unregisterAllStatusHandlers,
    cleanup,
  };
}

// 保留兼容旧代码的函数（将在完全迁移后移除）
export function useStatusMonitor() {
  console.warn(
    '⚠️ 使用已弃用的 useStatusMonitor() 全局单例。请迁移到 createStatusMonitorManager() 工厂函数。'
  );

  const serverStatus = ref<ServerStatus | null>(null);
  const statusError = ref<string | null>(null);

  const registerStatusHandlers = () => {
    console.warn('[状态监控模块][旧] 调用了已弃用的 registerStatusHandlers');
  };

  const unregisterAllStatusHandlers = () => {
    console.warn('[状态监控模块][旧] 调用了已弃用的 unregisterAllStatusHandlers');
  };

  // 返回与旧接口兼容的空对象，以避免错误
  return {
    serverStatus: readonly(serverStatus),
    statusError: readonly(statusError),
    registerStatusHandlers,
    unregisterAllStatusHandlers,
  };
}
