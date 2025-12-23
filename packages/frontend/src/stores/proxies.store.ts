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
        const response = await apiClient.get<ProxyInfo[]>('/proxies'); // 使用 apiClient
        this.proxies = response.data;
      } catch (err: any) {
        console.error('获取代理列表失败:', err);
        this.error = err.response?.data?.message || err.message || '获取代理列表时发生未知错误。';
        if (err.response?.status === 401) {
          console.warn('未授权，需要登录才能获取代理列表。');
          // TODO: 处理未授权情况
        }
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
      password?: string | null; // 包含原始密码
    }) {
      this.isLoading = true;
      this.error = null;
      try {
        const response = await apiClient.post<{ message: string; proxy: ProxyInfo }>(
          '/proxies',
          newProxyData
        ); // 使用 apiClient
        this.proxies.unshift(response.data.proxy); // 将新代理添加到列表开头
        return true; // 成功
      } catch (err: any) {
        console.error('添加代理失败:', err);
        this.error = err.response?.data?.message || err.message || '添加代理时发生未知错误。';
        if (err.response?.status === 401) {
          console.warn('未授权，需要登录才能添加代理。');
        }
        if (err.response?.status === 409) {
          console.warn('添加代理冲突:', err.response?.data?.message);
        }
        return false; // 失败
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
        ); // 使用 apiClient
        const index = this.proxies.findIndex((p) => p.id === proxyId);
        if (index !== -1) {
          // 使用返回的更新后的信息替换旧信息
          this.proxies[index] = { ...this.proxies[index], ...response.data.proxy };
        } else {
          await this.fetchProxies(); // 如果本地找不到，重新获取列表
        }
        return true; // 成功
      } catch (err: any) {
        console.error(`更新代理 ${proxyId} 失败:`, err);
        this.error = err.response?.data?.message || err.message || '更新代理时发生未知错误。';
        if (err.response?.status === 401) {
          console.warn('未授权，需要登录才能更新代理。');
        }
        if (err.response?.status === 409) {
          console.warn('更新代理冲突:', err.response?.data?.message);
        }
        return false; // 失败
      } finally {
        this.isLoading = false;
      }
    },

    // 删除代理 Action
    async deleteProxy(proxyId: number) {
      this.isLoading = true;
      this.error = null;
      try {
        await apiClient.delete(`/proxies/${proxyId}`); // 使用 apiClient
        this.proxies = this.proxies.filter((p) => p.id !== proxyId); // 从列表中移除
        return true; // 成功
      } catch (err: any) {
        console.error(`删除代理 ${proxyId} 失败:`, err);
        this.error = err.response?.data?.message || err.message || '删除代理时发生未知错误。';
        if (err.response?.status === 401) {
          console.warn('未授权，需要登录才能删除代理。');
        }
        return false; // 失败
      } finally {
        this.isLoading = false;
      }
    },
  },
});
