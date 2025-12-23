import { defineStore } from 'pinia';
import { ref } from 'vue';
import apiClient from '../utils/apiClient';
// Interface for basic SSH key info (for lists)
export interface SshKeyBasicInfo {
  id: number;
  name: string;
}

// Interface for detailed SSH key info (including decrypted key for editing)
// Be cautious when handling decryptedPrivateKey in the UI
export interface SshKeyDetails extends SshKeyBasicInfo {
  privateKey: string; // Decrypted private key
  passphrase?: string; // Decrypted passphrase
}

// Interface for creating/updating SSH keys (sending to backend)
export interface SshKeyInput {
  name: string;
  private_key: string; // Plain text private key
  passphrase?: string; // Plain text passphrase
}

export const useSshKeysStore = defineStore('sshKeys', () => {
  const sshKeys = ref<SshKeyBasicInfo[]>([]);
  const isLoading = ref(false);
  const error = ref<string | null>(null);

  // --- Actions ---

  // Fetch all SSH key names
  async function fetchSshKeys() {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.get<SshKeyBasicInfo[]>('/ssh-keys');
      sshKeys.value = response.data;
      console.log('SSH Keys fetched:', sshKeys.value);
    } catch (err: any) {
      console.error('Failed to fetch SSH keys:', err);
      error.value = err.response?.data?.message || err.message || '获取 SSH 密钥列表失败。';
      // Ensure error.value is not null before passing
      // uiNotificationsStore.addNotification({ message: error.value ?? '未知错误', type: 'error' }); // Removed notification
    } finally {
      isLoading.value = false;
    }
  }

  // Add a new SSH key
  async function addSshKey(keyInput: SshKeyInput): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.post<{ message: string; key: SshKeyBasicInfo }>(
        '/ssh-keys',
        keyInput
      );
      // Add the new key to the local list
      sshKeys.value.push(response.data.key);
      // Sort keys by name
      sshKeys.value.sort((a, b) => a.name.localeCompare(b.name));
      return true;
    } catch (err: any) {
      console.error('Failed to add SSH key:', err);
      error.value = err.response?.data?.message || err.message || '添加 SSH 密钥失败。';
      // Ensure error.value is not null before passing
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // Fetch decrypted details for a single key (used for editing)
  async function fetchDecryptedSshKey(id: number): Promise<SshKeyDetails | null> {
    isLoading.value = true; // Consider a different loading state if needed
    error.value = null;
    try {
      // Use the dedicated details endpoint
      const response = await apiClient.get<SshKeyDetails>(`/ssh-keys/${id}/details`);
      return response.data;
    } catch (err: any) {
      console.error(`Failed to fetch decrypted SSH key ${id}:`, err);
      error.value = err.response?.data?.message || err.message || `获取密钥 ${id} 详情失败。`;
      // Ensure error.value is not null before passing
      // uiNotificationsStore.addNotification({ message: error.value ?? '未知错误', type: 'error' }); // Removed notification
      return null;
    } finally {
      isLoading.value = false; // Reset loading state
    }
  }

  // Update an existing SSH key
  async function updateSshKey(id: number, keyInput: Partial<SshKeyInput>): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.put<{ message: string; key: SshKeyBasicInfo }>(
        `/ssh-keys/${id}`,
        keyInput
      );
      // Update the key in the local list
      const index = sshKeys.value.findIndex((key) => key.id === id);
      if (index !== -1) {
        sshKeys.value[index] = { ...sshKeys.value[index], ...response.data.key }; // Update with new basic info
        // Sort keys by name again if name changed
        sshKeys.value.sort((a, b) => a.name.localeCompare(b.name));
      }
      // uiNotificationsStore.addNotification({ message: response.data.message || 'SSH 密钥更新成功。', type: 'success' }); // Removed notification
      return true;
    } catch (err: any) {
      console.error(`Failed to update SSH key ${id}:`, err);
      error.value = err.response?.data?.message || err.message || `更新 SSH 密钥 ${id} 失败。`;
      // Ensure error.value is not null before passing
      // uiNotificationsStore.addNotification({ message: error.value ?? '未知错误', type: 'error' }); // Removed notification
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  // Delete an SSH key
  async function deleteSshKey(id: number): Promise<boolean> {
    isLoading.value = true;
    error.value = null;
    try {
      const response = await apiClient.delete<{ message: string }>(`/ssh-keys/${id}`);
      // Remove the key from the local list
      sshKeys.value = sshKeys.value.filter((key) => key.id !== id);
      // uiNotificationsStore.addNotification({ message: response.data.message || 'SSH 密钥删除成功。', type: 'success' }); // Removed notification
      return true;
    } catch (err: any) {
      console.error(`Failed to delete SSH key ${id}:`, err);
      error.value = err.response?.data?.message || err.message || `删除 SSH 密钥 ${id} 失败。`;
      // Ensure error.value is not null before passing
      // uiNotificationsStore.addNotification({ message: error.value ?? '未知错误', type: 'error' }); // Removed notification
      return false;
    } finally {
      isLoading.value = false;
    }
  }

  return {
    sshKeys,
    isLoading,
    error,
    fetchSshKeys,
    addSshKey,
    fetchDecryptedSshKey,
    updateSshKey,
    deleteSshKey,
  };
});
