import axios from 'axios';
import { handleUnauthorizedLogout } from './authRuntimeBridge';
import { log } from '@/utils/log';

export const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
export const AI_REQUEST_TIMEOUT_MS = 60_000;
const TRANSIENT_UPSTREAM_STATUS_CODES = [502, 503, 504] as const;

// 瞬时错误重试配置：最多重试 2 次，指数退避（350ms → 700ms → 1400ms）
const MAX_TRANSIENT_RETRIES = 2;
const BASE_RETRY_DELAY_MS = 350;

interface RetriableRequestConfig {
  method?: string;
  url?: string;
  __retryCount?: number;
}

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: '/api/v1', // 设置基础URL
  timeout: DEFAULT_REQUEST_TIMEOUT_MS, // 设置请求超时时间
  withCredentials: true, // 允许携带 cookie
});

// 请求拦截器 (可选，例如添加认证 Token)
apiClient.interceptors.request.use(
  (config) => {
    log.debug(`[apiClient Debug] ${config.method?.toUpperCase()} ${config.url}`);
    // 可以在这里添加逻辑，比如从 store 获取 token 并添加到请求头
    // const authStore = useAuthStore();
    // if (authStore.token) {
    //   config.headers.Authorization = `Bearer ${authStore.token}`;
    // }
    return config;
  },
  (error) => {
    // 处理请求错误
    log.error('Request error:', error);
    return Promise.reject(error);
  },
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 对响应数据做点什么
    return response;
  },
  async (error) => {
    // 处理响应错误
    const requestMethod = error.config?.method?.toUpperCase?.() ?? 'UNKNOWN';
    const requestUrl = error.config?.url ?? 'unknown';
    const rawRequestMethod = error.config?.method;

    if (error.response) {
      const { status, statusText, headers } = error.response;
      const contentType = headers?.['content-type'] ?? 'unknown';
      const isUpstreamUnavailableStatus = TRANSIENT_UPSTREAM_STATUS_CODES.includes(
        status as (typeof TRANSIENT_UPSTREAM_STATUS_CODES)[number],
      );

      // 对 GET 请求的瞬时上游错误做指数退避重试，减少偶发 502/503/504 带来的页面噪声
      // Cloudflare 代理场景下首屏并发请求偶尔触发 503，重试可有效恢复
      const requestConfig = error.config as RetriableRequestConfig | undefined;
      const retryCount = Number(requestConfig?.__retryCount ?? 0);
      const isGetRequest = rawRequestMethod?.toLowerCase?.() === 'get';
      if (
        requestConfig &&
        isGetRequest &&
        isUpstreamUnavailableStatus &&
        retryCount < MAX_TRANSIENT_RETRIES
      ) {
        requestConfig.__retryCount = retryCount + 1;
        const delay = BASE_RETRY_DELAY_MS * Math.pow(2, retryCount);
        log.warn(
          `[apiClient] 瞬时错误 ${status}，第 ${retryCount + 1}/${MAX_TRANSIENT_RETRIES} 次重试，延迟 ${delay}ms: ${requestMethod} ${requestUrl}`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        return apiClient.request(requestConfig);
      }

      const isHtmlResponse =
        typeof error.response.data === 'string' &&
        error.response.data.trimStart().startsWith('<!DOCTYPE html>');
      let bodySnippet = error.response.data;
      if (typeof error.response.data === 'string') {
        bodySnippet = isHtmlResponse ? '[html body omitted]' : error.response.data.slice(0, 160);
      }
      const responseErrorPayload = {
        status,
        statusText,
        method: requestMethod,
        url: requestUrl,
        contentType,
        data: bodySnippet,
      };
      if (isUpstreamUnavailableStatus) {
        log.warn('[apiClient] Response warning:', responseErrorPayload);
      } else {
        log.error('[apiClient] Response error:', responseErrorPayload);
      }

      // 处理常见的 HTTP 错误状态码
      switch (status) {
        case 401: // 未授权
          if (await handleUnauthorizedLogout()) {
            return Promise.reject(new Error('Unauthorized, logging out.'));
          }
          log.info('Unauthorized access to protected route.');
          break;
        case 403: // 禁止访问
          // 可以显示一个权限不足的提示
          log.error('Forbidden access.');
          break;
        case 404: // 未找到
          log.error('Resource not found.');
          break;
        case 500: // 服务器内部错误
          log.error('Internal server error.');
          break;
        case 502: // 网关错误
        case 503: // 服务不可用
        case 504: // 网关超时
          log.warn(
            `[apiClient] Upstream service unavailable (${status}) for ${requestMethod} ${requestUrl}`,
          );
          break;
        // 可以根据需要添加更多错误状态码的处理
        default:
          log.error(
            `[apiClient] Unhandled error status: ${status} (${requestMethod} ${requestUrl})`,
          );
      }
    } else if (error.request) {
      // 请求已发出，但没有收到响应 (例如网络问题)
      log.error(
        `[apiClient] Network error or no response received: ${requestMethod} ${requestUrl}`,
      );
    } else {
      // 发送请求时出了点问题
      log.error('[apiClient] Error setting up request:', error.message);
    }

    // 将错误继续抛出，以便调用方可以捕获并处理
    return Promise.reject(error);
  },
);

// Passkey Management（已迁移至 /api/v1/passkey 模块）
export const fetchPasskeys = () => {
  return apiClient.get('/passkey');
};

export const deletePasskey = (credentialID: string) => {
  return apiClient.delete(`/passkey/${credentialID}`);
};
export default apiClient;
