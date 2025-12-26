/**
 * useNL2CMD Composable
 * 处理终端中的自然语言转命令功能
 */

import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import apiClient from '../../utils/apiClient';
import type { NL2CMDRequest, NL2CMDResponse } from '../../types/nl2cmd.types';
import { useAISettingsStore } from '../../stores/aiSettings.store';

// 远程服务器 OS/Shell 类型配置
export interface RemoteSystemInfo {
  osType: string;
  shellType: string;
  currentPath?: string;
}

export function useNL2CMD() {
  const aiSettingsStore = useAISettingsStore();

  // 确保加载配置
  onMounted(async () => {
    await aiSettingsStore.ensureLoaded();
  });

  // 状态
  const isVisible = ref(false);
  const query = ref('');
  const isLoading = ref(false);

  // 远程系统信息（可由调用方设置）
  const remoteSystemInfo = ref<RemoteSystemInfo>({
    osType: 'Linux', // 默认：远程服务器最常见的是 Linux
    shellType: 'bash', // 默认：最常见的 Shell
    currentPath: '~',
  });

  // 计算属性：AI 是否已启用
  const isAIEnabled = computed(() => aiSettingsStore.settings.enabled);

  /**
   * 设置远程系统信息
   * 可由终端组件在连接时或检测到系统信息后调用
   */
  function setRemoteSystemInfo(info: Partial<RemoteSystemInfo>) {
    remoteSystemInfo.value = {
      ...remoteSystemInfo.value,
      ...info,
    };
  }

  /**
   * 显示 NL2CMD 输入框
   */
  function show() {
    if (!isAIEnabled.value) {
      ElMessage.warning('请先在设置中启用并配置 AI 助手');
      return;
    }
    isVisible.value = true;
    query.value = '';
  }

  /**
   * 隐藏 NL2CMD 输入框
   */
  function hide() {
    isVisible.value = false;
    query.value = '';
  }

  /**
   * 生成命令
   */
  async function generateCommand(): Promise<string | null> {
    if (!query.value.trim()) {
      ElMessage.warning('请输入命令描述');
      return null;
    }

    isLoading.value = true;
    try {
      const request: NL2CMDRequest = {
        query: query.value.trim(),
        // 使用远程系统信息，而非本地浏览器 UA 检测
        osType: remoteSystemInfo.value.osType,
        shellType: remoteSystemInfo.value.shellType,
        currentPath: remoteSystemInfo.value.currentPath,
      };

      if (import.meta.env.DEV) {
        console.log('[NL2CMD Debug] Request:', request);
      }

      const response = await apiClient.post<NL2CMDResponse>('/ai/nl2cmd', request);

      if (import.meta.env.DEV) {
        console.log('[NL2CMD Debug] Response:', response.data);
      }

      if (response.data.success) {
        const command = response.data.command;

        if (!command) {
          const msg = 'AI 未能生成命令，请尝试更详细地描述您的需求';
          if (import.meta.env.DEV) console.warn('[NL2CMD Debug] Empty command returned');
          ElMessage.warning(msg);
          return null;
        }

        // 如果有警告，显示警告信息
        if (response.data.warning) {
          ElMessage.warning({
            message: `⚠️ 危险命令警告：${response.data.warning}`,
            duration: 5000,
            showClose: true,
          });
        } else {
          ElMessage.success('命令已生成');
        }

        hide();
        return command;
      } else {
        const errorMsg = response.data.error || '生成命令失败';
        if (import.meta.env.DEV) console.error('[NL2CMD Debug] API Error:', errorMsg);
        ElMessage.error(errorMsg);
        return null;
      }
    } catch (error: any) {
      console.error('[NL2CMD] 生成命令失败:', error);
      const errorMsg = error.response?.data?.error || error.message || '生成命令失败';
      ElMessage.error(errorMsg);
      return null;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 取消生成
   */
  function cancel() {
    hide();
  }

  return {
    isVisible,
    query,
    isLoading,
    isAIEnabled,
    remoteSystemInfo,
    show,
    hide,
    generateCommand,
    cancel,
    setRemoteSystemInfo,
  };
}
