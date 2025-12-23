/**
 * P1-6: 标准化错误类型定义
 * 定义应用中所有错误代码和类型
 */

/**
 * 错误代码枚举
 * 遵循 HTTP 状态码 + 业务错误代码体系
 */
export enum ErrorCode {
  // 4xx 客户端错误
  BAD_REQUEST = 'BAD_REQUEST', // 400
  UNAUTHORIZED = 'UNAUTHORIZED', // 401
  FORBIDDEN = 'FORBIDDEN', // 403
  NOT_FOUND = 'NOT_FOUND', // 404
  VALIDATION_ERROR = 'VALIDATION_ERROR', // 422

  // 5xx 服务器错误
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR', // 500
  DATABASE_ERROR = 'DATABASE_ERROR', // 500
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE', // 503
}

/**
 * 错误严重级别
 */
export enum ErrorSeverity {
  LOW = 'low', // 预期内的错误（如参数验证失败）
  MEDIUM = 'medium', // 需要关注的错误（如资源未找到）
  HIGH = 'high', // 严重错误（如数据库连接失败）
  CRITICAL = 'critical', // 致命错误（如系统崩溃）
}

/**
 * 标准化错误响应接口
 */
export interface ErrorResponse {
  success: false;
  error: {
    code: ErrorCode;
    message: string; // 用户友好的错误消息
    details?: string; // 可选的额外细节（仅开发环境）
    requestId?: string; // 请求追踪 ID
    timestamp: string; // ISO 8601 时间戳
  };
}
