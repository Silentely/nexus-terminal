import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
import { cacheManager, CACHE_KEYS, CACHE_CONFIG } from '../utils/cacheManager';
import { extractErrorMessage } from '../utils/errorExtractor';
import { log } from '@/utils/log';

export interface ConnectionInfo {
  id: number;
  name: string;
  type: 'SSH' | 'RDP' | 'VNC' | 'Telnet';
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
   * Loads the connections list, using cached data when available and refreshing from the server; updates the connections cache if the server returns different data.
   *
   * Updates the store's `connections`, `isLoading`, and `error` refs to reflect progress and outcome. On failure sets a user-facing error message and logs the error; logs a warning when the failure is an HTTP 401 unauthorized.
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
   * Create a new connection record on the server and refresh the local connections list.
   *
   * @param newConnectionData - Data for the new connection. Optional fields depend on `type` and `auth_method` (for example, `password` for password auth, `private_key` and `passphrase` for key auth, and `vncPassword` for VNC). `proxy_id`, `proxy_type`, `tag_ids`, and `jump_chain` are optional and used when configuring proxies/tags.
   * @returns `true` if the connection was created and the local connections list was refreshed, `false` otherwise.
   */
  async function addConnection(newConnectionData: {
    name: string;
    type: 'SSH' | 'RDP' | 'VNC' | 'Telnet';
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
        newConnectionData,
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
   * Update an existing connection's stored configuration.
   *
   * @param connectionId - The identifier of the connection to update
   * @param updatedData - Partial connection fields to modify. May include connection metadata, authentication fields (e.g., `password`, `private_key`, `passphrase`, `vncPassword`), proxy/jump configuration (`proxy_id`, `proxy_type`, `jump_chain`), and tagging (`tag_ids`). Cannot modify `id`, `created_at`, `updated_at`, or `last_connected_at`.
   * @returns `true` if the update succeeded and the local connections list was refreshed, `false` otherwise.
   */
  async function updateConnection(
    connectionId: number,
    updatedData: Partial<
      Omit<ConnectionInfo, 'id' | 'created_at' | 'updated_at' | 'last_connected_at'> & {
        type?: 'SSH' | 'RDP' | 'VNC' | 'Telnet';
        password?: string;
        private_key?: string;
        passphrase?: string;
        vncPassword?: string;
        proxy_id?: number | null;
        proxy_type?: 'proxy' | 'jump' | null;
        tag_ids?: number[];
        jump_chain?: number[] | null;
      }
    >,
  ) {
    isLoading.value = true;
    error.value = null;
    try {
      await apiClient.put<{ message: string; connection: ConnectionInfo }>(
        `/connections/${connectionId}`,
        updatedData,
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
   * Delete the connection with the given ID, clear the cached connections, and remove it from the local store.
   *
   * @param connectionId - The ID of the connection to delete
   * @returns `true` if the deletion succeeded, `false` otherwise
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
   * Delete a single connection record without altering the store's `isLoading` or `error` state.
   *
   * @param connectionId - The numeric ID of the connection to delete
   * @returns An object with `success: true` when deletion succeeded; otherwise `success: false` and a `message` describing the failure
   */
  async function _deleteConnection(
    connectionId: number,
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
   * Delete multiple connections by their IDs.
   *
   * Attempts to delete each ID sequentially; updates the store's `isLoading` and `error` state to reflect progress and any partial failures.
   *
   * @param connectionIds - Array of connection IDs to delete; if empty or missing the function is a no-op and returns `true`
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
            : `删除连接 ID ${id} 失败 (未知原因)`,
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
   * Tests a remote connection and returns the test outcome.
   *
   * @param connectionId - The ID of the connection to test
   * @returns An object with `success` indicating whether the test succeeded, an optional `message` for user-facing details, and an optional `latency` measured in milliseconds
   */
  async function testConnection(
    connectionId: number,
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
   * Create a duplicate of an existing connection with a new name and refresh the local connection list.
   *
   * @param originalId - The ID of the connection to clone
   * @param newName - The name to assign to the cloned connection
   * @returns `true` if the clone succeeded and the connection list was refreshed, `false` otherwise
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
   * Add a tag to multiple connections and refresh the cached connection list.
   *
   * @param connectionIds - Array of connection IDs to receive the tag; if empty, no action is taken
   * @param tagId - ID of the tag to add to the specified connections
   * @returns `true` if the tag was added for all specified connections (or no IDs were provided), `false` if an error occurred
   */
  async function addTagToConnectionsAction(
    connectionIds: number[],
    tagId: number,
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
   * Update the tag list for a connection and refresh the local connections cache.
   *
   * @param connectionId - The ID of the connection to update
   * @param tagIds - Array of tag IDs to assign to the connection
   * @returns `true` if the update succeeded and local state was refreshed, `false` otherwise
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
   * Request a VNC session token for the specified connection, optionally constrained to a viewport width and/or height.
   *
   * @param connectionId - The ID of the connection to request the VNC session for
   * @param width - Optional viewport width in pixels to request for the session
   * @param height - Optional viewport height in pixels to request for the session
   * @returns The VNC session token string
   * @throws Propagates the original error when the network request fails or the server returns an error
   */
  async function getVncSessionToken(
    connectionId: number,
    width?: number,
    height?: number,
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
