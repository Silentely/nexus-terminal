import axios from 'axios';
import router from '../router';
import { useAuthStore } from '../stores/auth.store';

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: '/api/v1', // 设置基础URL
  timeout: 10000, // 设置请求超时时间
  withCredentials: true, // 允许携带 cookie
});

// 请求拦截器 (可选，例如添加认证 Token)
apiClient.interceptors.request.use(
  (config) => {
    // 可以在这里添加逻辑，比如从 store 获取 token 并添加到请求头
    // const authStore = useAuthStore();
    // if (authStore.token) {
    //   config.headers.Authorization = `Bearer ${authStore.token}`;
    // }
    return config;
  },
  (error) => {
    // 处理请求错误
    console.error('Request error:', error);
    return Promise.reject(error);
  }
);

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 对响应数据做点什么
    return response;
  },
  (error) => {
    // 处理响应错误
    console.error('Response error:', error.response || error.message);

    if (error.response) {
      const { status } = error.response;
      const authStore = useAuthStore(); // 在需要时获取 store 实例

      // 处理常见的 HTTP 错误状态码
      switch (status) {
        case 401: // 未授权
          // 如果用户当前是认证状态，则可能是 session 过期或无效
          if (authStore.isAuthenticated) {
            console.warn('Unauthorized access detected. Logging out.');
            // 调用 store 中的 logout 方法，它会处理状态重置和路由跳转
            authStore.logout();
            // 可以选择抛出错误或返回一个特定的值，防止后续代码执行
            return Promise.reject(new Error('Unauthorized, logging out.'));
          }
          // 如果用户本来就未认证，可能只是访问了需要登录的接口，暂时不强制跳转
          console.log('Unauthorized access to protected route.');

          break;
        case 403: // 禁止访问
          // 可以显示一个权限不足的提示
          console.error('Forbidden access.');
          break;
        case 404: // 未找到
          console.error('Resource not found.');
          break;
        case 500: // 服务器内部错误
          console.error('Internal server error.');
          break;
        // 可以根据需要添加更多错误状态码的处理
        default:
          console.error(`Unhandled error status: ${status}`);
      }
    } else if (error.request) {
      // 请求已发出，但没有收到响应 (例如网络问题)
      console.error('Network error or no response received:', error.request);
    } else {
      // 发送请求时出了点问题
      console.error('Error setting up request:', error.message);
    }

    // 将错误继续抛出，以便调用方可以捕获并处理
    return Promise.reject(error);
  }
);

// Passkey Management
export const fetchPasskeys = () => {
  return apiClient.get('/auth/user/passkeys');
};

export const deletePasskey = (credentialID: string) => {
  return apiClient.delete(`/auth/user/passkeys/${credentialID}`);
};
export default apiClient;
