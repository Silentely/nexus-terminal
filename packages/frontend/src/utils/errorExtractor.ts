/**
 * 统一的 API 错误消息提取器
 * 从 Axios 错误对象中提取用户友好的错误消息
 */

interface ApiErrorResponse {
  code?: string;
  message?: string;
  requestId?: string;
  timestamp?: string;
}

interface ApiError {
  response?: {
    data?: {
      error?: string | ApiErrorResponse;
      message?: string;
    };
    status?: number;
  };
  message?: string;
}

/**
 * 从 API 错误中提取消息
 * 优先使用 data.error.message（新格式 { success: false, error: { code, message } }），
 * 回退到 data.error（字符串格式）、data.message（旧格式），
 * 最后使用 Axios 错误消息或后备文本。
 * @param err 捕获的错误对象
 * @param fallback 后备消息（当无法提取时使用）
 */
export function extractErrorMessage(err: unknown, fallback: string): string {
  const apiErr = err as ApiError;
  const errorData = apiErr?.response?.data?.error;

  // 新格式：error 是对象 { code, message, requestId, timestamp }
  if (typeof errorData === 'object' && errorData !== null && 'message' in errorData) {
    return (errorData as ApiErrorResponse).message || fallback;
  }

  // 旧格式：error 是字符串
  return (
    (typeof errorData === 'string' ? errorData : null) ||
    apiErr?.response?.data?.message ||
    apiErr?.message ||
    fallback
  );
}
