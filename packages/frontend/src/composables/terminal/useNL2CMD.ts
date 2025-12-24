/**
 * useNL2CMD Composable
 * 处理终端中的自然语言转命令功能
 */

import { ref, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import apiClient from '../../utils/apiClient';
import type { NL2CMDRequest, NL2CMDResponse } from '../../types/nl2cmd.types';
import { useAISettingsStore } from '../../stores/aiSettings.store';

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

  // 计算属性：AI 是否已启用
  const isAIEnabled = computed(() => aiSettingsStore.settings.enabled);

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
   * 检测操作系统类型
   */
  function detectOSType(): string {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'Windows';
    if (ua.includes('mac')) return 'macOS';
    if (ua.includes('linux')) return 'Linux';
    return 'Linux'; // 默认
  }

  /**
   * 检测 Shell 类型（基于用户代理，实际应该从 SSH 会话中获取）
   */
  function detectShellType(): string {
    const ua = navigator.userAgent.toLowerCase();
    if (ua.includes('win')) return 'PowerShell';
    // 对于 Linux/macOS，默认 bash，实际应从服务端获取
    return 'bash';
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
        osType: detectOSType(),
        shellType: detectShellType(),
      };

      const response = await apiClient.post<NL2CMDResponse>('/api/v1/ai/nl2cmd', request);

      if (response.data.success && response.data.command) {
        const command = response.data.command;

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
        ElMessage.error(response.data.error || '生成命令失败');
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
    show,
    hide,
    generateCommand,
    cancel,
  };
}
