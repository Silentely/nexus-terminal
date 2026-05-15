import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
import { cacheManager, CACHE_KEYS, CACHE_CONFIG } from '../utils/cacheManager';
import { extractErrorMessage } from '../utils/errorExtractor';
import { log } from '@/utils/log';

export interface ConnectionInfo {
  id: number;
  name: string;
  type: 'SSH' | 'RDP' | 'VNC';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  proxy_id?: number | null;
  proxy_type?: 'proxy' | 'jump' | null;
  tag_ids?: number[];
  ssh_key_id?: number | null;
  created_at: number;
  updated_at: number;
  last_connected_at: number | null;
  notes?: string | null;
  vncPassword?: string;
  jump_chain?: number[] | null;
  force_keyboard_interactive?: boolean;
}

const isUnauthorizedError = (err: unknown): boolean => {
  const maybeError = err as { response?: { status?: number } };
  return maybeError.response?.status === 401;
};

export const useConnectionsStore = defineStore('connections', () => {
  // --- State ---
  const connections = ref<ConnectionInfo[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Loads the list of connections into the store, preferring cached data and refreshing from the server.
   *
   * Fetches cached connections if available, requests fresh data from the API, and updates the `connections` state and cache only when the fresh data differs from the current state. Also manages `isLoading` and `error` state and logs an unauthorized warning when a 401 response is encountered.
   */
  async function fetchConnections() {
    const cacheOptions = CACHE_CONFIG[CACHE_KEYS.CONNECTIONS];
    error.value = null;

    const cachedData = cacheManager.get<ConnectionInfo[]>(CACHE_KEYS.CONNECTIONS, [], cacheOptions);
    if (cachedData.length > 0) {
      connections.value = cachedData;
      isLoading.value = false;
    } else {
      isLoading.value = true;
    }
    try {
      const response = await apiClient.get<ConnectionInfo[]>('/connections');
      const freshData = response.data;

      const currentDataString = JSON.stringify(connections.value);
      const freshDataString = JSON.stringify(freshData);
      if (currentDataString !== freshDataString) {
        connections.value = freshData;
        cacheManager.set(CACHE_KEYS.CONNECTIONS, freshData, cacheOptions);
      }
      error.value = null;
    } catch (err: unknown) {
      log.error('[ConnectionsStore] 获取连接列表失败:', err);
      error.value = extractErrorMessage(err, '获取连接列表时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('[ConnectionsStore] 未授权，需要登录才能获取连接列表。');
      }
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Creates a new connection record on the server and refreshes the local connections list.
   *
   * @param newConnectionData - Connection properties: required `name`, `type` ('SSH' | 'RDP' | 'VNC'), `host`, `port`, `username`, and `auth_method` ('password' | 'key'); optional fields include authentication details (`password`, `private_key`, `passphrase`, `vncPassword`), proxy settings (`proxy_id`, `proxy_type`), tags (`tag_ids`), and `jump_chain`.
   * @returns `true` if the connection was created and the local list refreshed, `false` otherwise.
   */
  async function addConnection(newConnectionData: {
    name: string;
    type: 'SSH' | 'RDP' | 'VNC';
    host: string;
    port: number;
    username: string;
    auth_method: 'password' | 'key';
    password?: string;
    private_key?: string;
    passphrase?: string;
    vncPassword?: string;
    proxy_id?: number | null;
    proxy_type?: 'proxy' | 'jump' | null;
    tag_ids?: number[];
    jump_chain?: number[] | null;
  }) {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.post<{ message: string; connection: ConnectionInfo }>(
        '/connections',
        newConnectionData
      );
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      await fetchConnections();
      return true;
    } catch (err: unknown) {
      log.error('添加连接失败:', err);
      error.value = extractErrorMessage(err, '添加连接时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能添加连接。');
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Update an existing connection record on the server and refresh the local connections store.
   *
   * @param connectionId - The ID of the connection to update
   * @param updatedData - Partial connection fields to update (allowed keys include connection parameters such as `type`, `host`, `port`, credentials like `password`, `private_key`, `passphrase`, `vncPassword`, proxy fields `proxy_id` / `proxy_type`, tag-related `tag_ids`, and `jump_chain`)
   * @returns `true` if the update succeeded and the local store was refreshed, `false` otherwise
   */
  async function updateConnection(
    connectionId: number,
    updatedData: Partial<
      Omit<ConnectionInfo, 'id' | 'created_at' | 'updated_at' | 'last_connected_at'> & {
        type?: 'SSH' | 'RDP' | 'VNC';
        password?: string;
        private_key?: string;
        passphrase?: string;
        vncPassword?: string;
        proxy_id?: number | null;
        proxy_type?: 'proxy' | 'jump' | null;
        tag_ids?: number[];
        jump_chain?: number[] | null;
      }
    >
  ) {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.put<{ message: string; connection: ConnectionInfo }>(
        `/connections/${connectionId}`,
        updatedData
      );
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      await fetchConnections();
      return true;
    } catch (err: unknown) {
      log.error(`更新连接 ${connectionId} 失败:`, err);
      error.value = extractErrorMessage(err, '更新连接时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能更新连接。');
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Deletes a connection by its ID, removes the connections cache entry, and updates the store's connections list.
   *
   * @param connectionId - The numeric ID of the connection to delete
   * @returns `true` if the connection was deleted successfully, `false` otherwise
   */
  async function deleteConnection(connectionId: number) {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.delete(`/connections/${connectionId}`);
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      connections.value = connections.value.filter((conn) => conn.id !== connectionId);
      return true;
    } catch (err: unknown) {
      log.error(`删除连接 ${connectionId} 失败:`, err);
      error.value = extractErrorMessage(err, '删除连接时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能删除连接。');
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Delete the connection with the given ID without changing the store's loading or error state.
   *
   * @param connectionId - The ID of the connection to delete
   * @returns An object with `success: true` when the deletion succeeded; otherwise `success: false` and `message` containing an error description
   */
  async function _deleteConnection(
    connectionId: number
  ): Promise<{ success: boolean; message?: string }> {
    try {
      await apiClient.delete(`/connections/${connectionId}`);
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      connections.value = connections.value.filter((conn) => conn.id !== connectionId);
      return { success: true };
    } catch (err: unknown) {
      log.error(`删除连接 ${connectionId} 失败:`, err);
      const message = extractErrorMessage(err, '删除连接时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能删除连接。');
      }
      return { success: false, message };
    }
  }

  /**
   * Attempts to delete multiple connections by their IDs and updates the store's loading and error state.
   *
   * If `connectionIds` is empty or undefined, the function returns `true` immediately. The function sets the store's loading flag while processing and records a combined error message if any individual deletion fails.
   *
   * @param connectionIds - Array of connection IDs to delete
   * @returns `true` if all specified connections were deleted successfully, `false` if one or more deletions failed
   */
  async function deleteBatchConnections(connectionIds: number[]): Promise<boolean> {
    if (!connectionIds || connectionIds.length === 0) {
      log.warn('[ConnectionsStore] deleteBatchConnections called with no IDs.');
      return true;
    }
    isLoading.value = true;
    error.value = null;
    let allSucceeded = true;
    const individualErrors: string[] = [];

    for (const id of connectionIds) {
      const result = await _deleteConnection(id);
      if (!result.success) {
        allSucceeded = false;
        individualErrors.push(
          result.message
            ? `删除连接 ID ${id} 失败: ${result.message}`
            : `删除连接 ID ${id} 失败 (未知原因)`
        );
      }
    }

    if (!allSucceeded) {
      error.value = `批量删除操作中部分连接未能成功删除。详情: ${individualErrors.join('; ')}`;
      log.error('[ConnectionsStore] Batch delete operation completed with one or more failures.');
    } else {
      error.value = null;
    }

    isLoading.value = false;
    return allSucceeded;
  }

  /**
   * Initiates a connectivity test for the specified connection.
   *
   * @param connectionId - The numeric ID of the connection to test
   * @returns An object with `success` indicating test result, an optional human-readable `message`, and an optional `latency` (in milliseconds) when available
   */
  async function testConnection(
    connectionId: number
  ): Promise<{ success: boolean; message?: string; latency?: number }> {
    try {
      const response = await apiClient.post<{
        success: boolean;
        message: string;
        latency?: number;
      }>(`/connections/${connectionId}/test`);
      return {
        success: response.data.success,
        message: response.data.message,
        latency: response.data.latency,
      };
    } catch (err: unknown) {
      log.error(`测试连接 ${connectionId} 失败:`, err);
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能测试连接。');
      }
      return { success: false, message: extractErrorMessage(err, '测试连接时发生未知错误。') };
    }
  }

  /**
   * Clone an existing connection record under a new name.
   *
   * @param originalId - The ID of the connection to clone
   * @param newName - The name to assign to the cloned connection
   * @returns `true` if the clone request succeeded and the local connections list was refreshed, `false` otherwise
   */
  async function cloneConnection(originalId: number, newName: string): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.post(`/connections/${originalId}/clone`, { name: newName });
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      await fetchConnections();
      return true;
    } catch (err: unknown) {
      log.error(`克隆连接 ${originalId} 失败:`, err);
      error.value = extractErrorMessage(err, '克隆连接时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能克隆连接。');
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Add a tag to multiple connections.
   *
   * If `connectionIds` is empty, the function returns `true` immediately without making any requests.
   *
   * @param connectionIds - Array of connection IDs to which the tag will be added
   * @param tagId - ID of the tag to add to the specified connections
   * @returns `true` if the tag was successfully added (or no IDs were provided), `false` on failure
   */
  async function addTagToConnectionsAction(
    connectionIds: number[],
    tagId: number
  ): Promise<boolean> {
    if (connectionIds.length === 0) return true;
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.post('/connections/add-tag', {
        connection_ids: connectionIds,
        tag_id: tagId,
      });
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      await fetchConnections();
      return true;
    } catch (err: unknown) {
      log.error(`为连接 ${connectionIds.join(', ')} 添加标签 ${tagId} 失败:`, err);
      error.value = extractErrorMessage(err, '为连接添加标签时发生未知错误。');
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能为连接添加标签。');
      }
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Update the tags assigned to a connection and refresh the local connections list.
   *
   * @param connectionId - The ID of the connection to update
   * @param tagIds - The list of tag IDs to assign to the connection
   * @returns `true` if the update succeeded, `false` otherwise
   */
  async function updateConnectionTags(connectionId: number, tagIds: number[]): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.put(`/connections/${connectionId}/tags`, { tag_ids: tagIds });
      cacheManager.remove(CACHE_KEYS.CONNECTIONS);
      await fetchConnections();
      return true;
    } catch (err: unknown) {
      log.error(`更新连接 ${connectionId} 的标签失败:`, err);
      error.value = extractErrorMessage(err, '更新连接标签时发生未知错误。');
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * Request a VNC session token for a specific connection.
   *
   * @param connectionId - The ID of the connection to create a VNC session for
   * @param width - Optional desired framebuffer width in pixels
   * @param height - Optional desired framebuffer height in pixels
   * @returns The VNC session token string if issued, `null` otherwise
   * @throws Rethrows the original error if the request fails (logs and warns on 401 Unauthorized before rethrowing)
   */
  async function getVncSessionToken(
    connectionId: number,
    width?: number,
    height?: number
  ): Promise<string | null> {
    try {
      let apiUrl = `/connections/${connectionId}/vnc-session`;
      const params = new URLSearchParams();
      if (width !== undefined) {
        params.append('width', String(width));
      }
      if (height !== undefined) {
        params.append('height', String(height));
      }
      const queryString = params.toString();
      if (queryString) {
        apiUrl += `?${queryString}`;
      }
      const response = await apiClient.post<{ token: string }>(apiUrl);
      return response.data.token;
    } catch (err: unknown) {
      log.error(`获取 VNC 会话令牌失败 (连接 ID: ${connectionId}):`, err);
      if (isUnauthorizedError(err)) {
        log.warn('未授权，需要登录才能获取 VNC 会话令牌。');
      }
      throw err;
    }
  }

  return {
    connections,
    isLoading,
    error,
    fetchConnections,
    addConnection,
    updateConnection,
    deleteConnection,
    deleteBatchConnections,
    testConnection,
    cloneConnection,
    addTagToConnectionsAction,
    updateConnectionTags,
    getVncSessionToken,
  };
});
