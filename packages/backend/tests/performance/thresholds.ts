/**
 * 性能测试阈值配置
 *
 * 定义各类性能测试的基准指标，包括：
 * - API 响应时间（毫秒）
 * - 并发连接数限制
 * - 内存占用基准（字节）
 */

export const PERFORMANCE_THRESHOLDS = {
  // API 端点响应时间阈值（单位：毫秒）
  api: {
    // 认证相关
    login: { maxLatency: 500 }, // 登录接口（包含 bcrypt 哈希计算）
    register: { maxLatency: 600 }, // 注册接口（包含密码哈希）
    logout: { maxLatency: 100 }, // 登出接口
    validateSession: { maxLatency: 50 }, // 会话验证

    // 连接管理
    connectionList: { maxLatency: 200 }, // 连接列表查询
    connectionCreate: { maxLatency: 300 }, // 创建新连接
    connectionUpdate: { maxLatency: 200 }, // 更新连接配置
    connectionDelete: { maxLatency: 150 }, // 删除连接

    // 文件操作
    fileList: { maxLatency: 300 }, // SFTP 文件列表
    fileUpload: { maxLatency: 5000 }, // 文件上传（10MB 文件）
    fileDownload: { maxLatency: 5000 }, // 文件下载（10MB 文件）
    fileDelete: { maxLatency: 200 }, // 文件删除

    // 系统设置
    settings: { maxLatency: 100 }, // 读取设置
    updateSettings: { maxLatency: 150 }, // 更新设置

    // 批量操作
    batchCreate: { maxLatency: 500 }, // 创建批量任务
    batchStatus: { maxLatency: 200 }, // 查询任务状态

    // AI 智能运维
    aiAnalysis: { maxLatency: 3000 }, // AI 分析请求（可能较慢）
    aiSession: { maxLatency: 200 }, // AI 会话管理
  },

  // 并发连接数限制
  concurrent: {
    sshConnections: 50, // 同时支持的 SSH 连接数
    websocketConnections: 100, // 同时支持的 WebSocket 连接数
    sftpTransfers: 10, // 同时支持的 SFTP 传输任务数
    batchSubtasks: 20, // 批量任务并发执行数
  },

  // 内存占用基准（单位：字节）
  memory: {
    backendIdle: 100 * 1024 * 1024, // 后端空闲状态内存（100MB）
    sshSessionIncrement: 5 * 1024 * 1024, // 每个 SSH 会话增量（5MB）
    sftpSessionIncrement: 3 * 1024 * 1024, // 每个 SFTP 会话增量（3MB）
    websocketConnectionIncrement: 1 * 1024 * 1024, // 每个 WebSocket 连接增量（1MB）
    maxTotalMemory: 500 * 1024 * 1024, // 最大总内存占用（500MB）
  },

  // 数据库查询性能阈值
  database: {
    simpleQuery: 50, // 简单查询（无 JOIN）
    complexQuery: 150, // 复杂查询（多表 JOIN）
    bulkInsert: 500, // 批量插入（100条记录）
    indexedSearch: 100, // 索引字段搜索
  },

  // WebSocket 通信性能
  websocket: {
    messageLatency: 50, // 消息往返延迟
    heartbeatInterval: 30000, // 心跳间隔（桌面端）
    heartbeatIntervalMobile: 60000, // 心跳间隔（移动端）
    reconnectTimeout: 5000, // 重连超时
  },

  // 负载测试配置
  load: {
    rampUpDuration: 10, // 负载爬升时间（秒）
    sustainDuration: 30, // 负载维持时间（秒）
    requestsPerSecond: 100, // 目标 RPS
  },
};

/**
 * 获取指定类型的性能阈值
 */
export function getThreshold(category: keyof typeof PERFORMANCE_THRESHOLDS, key: string): number {
  const categoryThresholds = PERFORMANCE_THRESHOLDS[category];
  if (!categoryThresholds || typeof categoryThresholds !== 'object') {
    throw new Error(`未知的性能阈值类别: ${category}`);
  }

  const threshold = (categoryThresholds as Record<string, number | { maxLatency: number }>)[key];
  if (typeof threshold === 'number') {
    return threshold;
  }
  if (threshold && typeof threshold === 'object' && 'maxLatency' in threshold) {
    return threshold.maxLatency;
  }

  throw new Error(`未找到性能阈值: ${category}.${key}`);
}

/**
 * 验证性能指标是否在阈值范围内
 */
export function validatePerformance(
  category: keyof typeof PERFORMANCE_THRESHOLDS,
  key: string,
  actualValue: number,
): { passed: boolean; threshold: number; actualValue: number; margin: number } {
  const threshold = getThreshold(category, key);
  const passed = actualValue <= threshold;
  const margin = threshold - actualValue;

  return {
    passed,
    threshold,
    actualValue,
    margin,
  };
}
