import { defineStore } from 'pinia';
import apiClient from '../utils/apiClient'; // 使用统一的 apiClient

// 定义代理信息接口 (前端使用，不含密码)
export interface ProxyInfo {
  id: number;
  name: string;
  type: 'SOCKS5' | 'HTTP';
  host: string;
  port: number;
  username?: string | null;
  created_at: number;
  updated_at: number;
}

// 定义 Store State 的接口
interface ProxiesState {
  proxies: ProxyInfo[];
  isLoading: boolean;
  error: string | null;
}

// 定义 Pinia Store
export const useProxiesStore = defineStore('proxies', {
  state: (): ProxiesState => ({
    proxies: [],
    isLoading: false,
    error: null,
  }),
  actions: {
    // 获取代理列表 Action
    async fetchProxies() {
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.get<ProxyInfo[]>('/proxies');
        this.proxies = response.data;
      } catch (err: any) {
        console.error('获取代理列表失败:', err);
        this.error = err.response?.data?.message || err.message || '获取代理列表时发生未知错误。';
        // 401 未授权由 apiClient 拦截器统一处理
      } finally {
        this.isLoading = false;
      }
    },

    // 添加新代理 Action
    async addProxy(newProxyData: {
      name: string;
      type: 'SOCKS5' | 'HTTP';
      host: string;
      port: number;
      username?: string | null;
      password?: string | null;
    }) {
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.post<{ message: string; proxy: ProxyInfo }>(
          '/proxies',
          newProxyData
        );
        this.proxies.unshift(response.data.proxy);
        return true;
      } catch (err: any) {
        console.error('添加代理失败:', err);
        this.error = err.response?.data?.message || err.message || '添加代理时发生未知错误。';
        // 401/409 错误：401 由拦截器处理，409 冲突已记录在 error
        return false;
      } finally {
        this.isLoading = false;
      }
    },

    // 更新代理 Action
    async updateProxy(
      proxyId: number,
      updatedData: Partial<ProxyInfo & { password?: string | null }>
    ) {
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.put<{ message: string; proxy: ProxyInfo }>(
          `/proxies/${proxyId}`,
          updatedData
        );
        const index = this.proxies.findIndex((p) => p.id === proxyId);
        if (index !== -1) {
          this.proxies[index] = { ...this.proxies[index], ...response.data.proxy };
        } else {
          await this.fetchProxies();
        }
        return true;
      } catch (err: any) {
        console.error(`更新代理 ${proxyId} 失败:`, err);
        this.error = err.response?.data?.message || err.message || '更新代理时发生未知错误。';
        // 401/409 错误：401 由拦截器处理，409 冲突已记录在 error
        return false;
      } finally {
        this.isLoading = false;
      }
    },

    // 删除代理 Action
    async deleteProxy(proxyId: number) {
      this.isLoading = true;
      this.error = null;
      try {
        await apiClient.delete(`/proxies/${proxyId}`);
        this.proxies = this.proxies.filter((p) => p.id !== proxyId);
        return true;
      } catch (err: any) {
        console.error(`删除代理 ${proxyId} 失败:`, err);
        this.error = err.response?.data?.message || err.message || '删除代理时发生未知错误。';
        // 401 由拦截器统一处理
        return false;
      } finally {
        this.isLoading = false;
      }
    },
  },
});
