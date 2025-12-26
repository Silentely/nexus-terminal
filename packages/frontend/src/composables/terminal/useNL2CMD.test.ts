/**
 * useNL2CMD Composable 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useNL2CMD } from './useNL2CMD';
import { useAISettingsStore } from '../../stores/aiSettings.store';
import apiClient from '../../utils/apiClient';
import { ElMessage } from 'element-plus';

// Mock 依赖
vi.mock('../../utils/apiClient', () => ({
  default: {
    post: vi.fn(),
  },
}));

vi.mock('element-plus', () => ({
  ElMessage: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../stores/aiSettings.store', () => ({
  useAISettingsStore: vi.fn(() => ({
    settings: {
      enabled: true,
      provider: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-test',
      model: 'gpt-4',
    },
    ensureLoaded: vi.fn(),
  })),
}));

describe('useNL2CMD', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该有正确的默认远程系统信息', () => {
      const { remoteSystemInfo } = useNL2CMD();

      expect(remoteSystemInfo.value.osType).toBe('Linux');
      expect(remoteSystemInfo.value.shellType).toBe('bash');
      expect(remoteSystemInfo.value.currentPath).toBe('~');
    });

    it('应该默认隐藏输入框', () => {
      const { isVisible } = useNL2CMD();
      expect(isVisible.value).toBe(false);
    });
  });

  describe('setRemoteSystemInfo', () => {
    it('应该正确设置远程系统信息', () => {
      const { remoteSystemInfo, setRemoteSystemInfo } = useNL2CMD();

      setRemoteSystemInfo({
        osType: 'Ubuntu',
        shellType: 'zsh',
        currentPath: '/home/user',
      });

      expect(remoteSystemInfo.value.osType).toBe('Ubuntu');
      expect(remoteSystemInfo.value.shellType).toBe('zsh');
      expect(remoteSystemInfo.value.currentPath).toBe('/home/user');
    });

    it('应该支持部分更新', () => {
      const { remoteSystemInfo, setRemoteSystemInfo } = useNL2CMD();

      setRemoteSystemInfo({ osType: 'CentOS' });

      expect(remoteSystemInfo.value.osType).toBe('CentOS');
      expect(remoteSystemInfo.value.shellType).toBe('bash'); // 保持默认值
    });
  });

  describe('show/hide', () => {
    it('当 AI 未启用时应显示警告', () => {
      vi.mocked(useAISettingsStore).mockReturnValue({
        settings: { enabled: false },
        ensureLoaded: vi.fn(),
      } as any);

      const { show, isVisible } = useNL2CMD();
      show();

      expect(ElMessage.warning).toHaveBeenCalledWith('请先在设置中启用并配置 AI 助手');
      expect(isVisible.value).toBe(false);
    });

    it('当 AI 已启用时应显示输入框', () => {
      const { show, isVisible } = useNL2CMD();
      show();

      expect(isVisible.value).toBe(true);
    });

    it('hide 应该隐藏输入框并清空查询', () => {
      const { show, hide, isVisible, query } = useNL2CMD();

      show();
      query.value = 'test query';
      hide();

      expect(isVisible.value).toBe(false);
      expect(query.value).toBe('');
    });
  });

  describe('generateCommand', () => {
    it('当查询为空时应显示警告', async () => {
      const { generateCommand, query } = useNL2CMD();
      query.value = '';

      const result = await generateCommand();

      expect(ElMessage.warning).toHaveBeenCalledWith('请输入命令描述');
      expect(result).toBeNull();
    });

    it('应该发送正确的请求参数', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, command: 'ls -la' },
      });

      const { generateCommand, query, setRemoteSystemInfo } = useNL2CMD();
      query.value = '列出当前目录的文件';
      setRemoteSystemInfo({
        osType: 'Ubuntu',
        shellType: 'bash',
        currentPath: '/home/user',
      });

      await generateCommand();

      expect(apiClient.post).toHaveBeenCalledWith('/api/v1/ai/nl2cmd', {
        query: '列出当前目录的文件',
        osType: 'Ubuntu',
        shellType: 'bash',
        currentPath: '/home/user',
      });
    });

    it('应该在生成成功时返回命令', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, command: 'find . -size +100M' },
      });

      const { generateCommand, query } = useNL2CMD();
      query.value = '查找大于100M的文件';

      const result = await generateCommand();

      expect(result).toBe('find . -size +100M');
      expect(ElMessage.success).toHaveBeenCalledWith('命令已生成');
    });

    it('应该在有警告时显示警告消息', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: {
          success: true,
          command: 'rm -rf /',
          warning: '此命令极度危险！',
        },
      });

      const { generateCommand, query } = useNL2CMD();
      query.value = '删除所有文件';

      const result = await generateCommand();

      expect(result).toBe('rm -rf /');
      expect(ElMessage.warning).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.stringContaining('危险命令警告'),
        })
      );
    });

    it('应该在生成失败时显示错误', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: false, error: 'API 错误' },
      });

      const { generateCommand, query } = useNL2CMD();
      query.value = 'test';

      const result = await generateCommand();

      expect(result).toBeNull();
      expect(ElMessage.error).toHaveBeenCalledWith('API 错误');
    });
  });
});
