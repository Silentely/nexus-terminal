/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// Mock apiClient
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));

// Mock extractErrorMessage
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((err: unknown, fallback: string) => {
    if (err instanceof Error) return err.message;
    return fallback;
  }),
}));

import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';
import { useNotificationsStore } from './notificationChannels.store';
import type {
  NotificationSetting,
  NotificationSettingData,
  NotificationChannelConfig,
} from '../types/server.types';

// 辅助：创建模拟通知设置数据
const createMockSetting = (overrides: Partial<NotificationSetting> = {}): NotificationSetting => ({
  id: overrides.id ?? 1,
  channel_type: overrides.channel_type ?? 'webhook',
  name: overrides.name ?? '测试 Webhook',
  enabled: overrides.enabled ?? true,
  config: overrides.config ?? { url: 'https://example.com/webhook' },
  enabled_events: overrides.enabled_events ?? ['LOGIN_SUCCESS', 'LOGOUT'],
  created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
  updated_at: overrides.updated_at ?? '2026-01-01T00:00:00Z',
});

const createMockSettingData = (
  overrides: Partial<NotificationSettingData> = {},
): NotificationSettingData => ({
  channel_type: overrides.channel_type ?? 'email',
  name: overrides.name ?? '测试邮件通知',
  enabled: overrides.enabled ?? true,
  config: overrides.config ?? { to: 'test@example.com' },
  enabled_events: overrides.enabled_events ?? ['LOGIN_FAILURE'],
});

describe('notificationChannels.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  describe('初始状态', () => {
    it('settings 应该为空数组', () => {
      const store = useNotificationsStore();
      expect(store.settings).toEqual([]);
    });

    it('isLoading 应该为 false', () => {
      const store = useNotificationsStore();
      expect(store.isLoading).toBe(false);
    });

    it('error 应该为 null', () => {
      const store = useNotificationsStore();
      expect(store.error).toBeNull();
    });
  });

  describe('Computed 属性', () => {
    it('webhookSettings 应该只返回 webhook 类型的设置', () => {
      const store = useNotificationsStore();
      const mockData = [
        createMockSetting({ id: 1, channel_type: 'webhook' }),
        createMockSetting({ id: 2, channel_type: 'email' }),
        createMockSetting({ id: 3, channel_type: 'webhook' }),
      ];
      store.settings = mockData;

      expect(store.webhookSettings).toHaveLength(2);
      expect(store.webhookSettings[0].id).toBe(1);
      expect(store.webhookSettings[1].id).toBe(3);
    });

    it('emailSettings 应该只返回 email 类型的设置', () => {
      const store = useNotificationsStore();
      const mockData = [
        createMockSetting({ id: 1, channel_type: 'webhook' }),
        createMockSetting({ id: 2, channel_type: 'email' }),
        createMockSetting({ id: 3, channel_type: 'telegram' }),
      ];
      store.settings = mockData;

      expect(store.emailSettings).toHaveLength(1);
      expect(store.emailSettings[0].id).toBe(2);
    });

    it('telegramSettings 应该只返回 telegram 类型的设置', () => {
      const store = useNotificationsStore();
      const mockData = [
        createMockSetting({ id: 1, channel_type: 'telegram' }),
        createMockSetting({ id: 2, channel_type: 'telegram' }),
        createMockSetting({ id: 3, channel_type: 'webhook' }),
      ];
      store.settings = mockData;

      expect(store.telegramSettings).toHaveLength(2);
      expect(store.telegramSettings[0].id).toBe(1);
      expect(store.telegramSettings[1].id).toBe(2);
    });

    it('所有 computed 属性在空状态下应返回空数组', () => {
      const store = useNotificationsStore();
      expect(store.webhookSettings).toEqual([]);
      expect(store.emailSettings).toEqual([]);
      expect(store.telegramSettings).toEqual([]);
    });
  });

  describe('fetchSettings', () => {
    it('应该成功获取通知设置列表', async () => {
      const mockData = [createMockSetting({ id: 1 }), createMockSetting({ id: 2 })];
      vi.mocked(apiClient.get).mockResolvedValue({ data: mockData });

      const store = useNotificationsStore();
      await store.fetchSettings();

      expect(apiClient.get).toHaveBeenCalledWith('/notifications');
      expect(store.settings).toEqual(mockData);
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });

    it('获取失败时应设置错误信息并清空 settings', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('网络错误'));

      const store = useNotificationsStore();
      await store.fetchSettings();

      expect(store.error).toBe('网络错误');
      expect(store.settings).toEqual([]);
      expect(store.isLoading).toBe(false);
    });

    it('获取失败时应调用 extractErrorMessage', async () => {
      vi.mocked(apiClient.get).mockRejectedValue(new Error('服务器异常'));

      const store = useNotificationsStore();
      await store.fetchSettings();

      expect(extractErrorMessage).toHaveBeenCalledWith(expect.any(Error), '获取通知设置失败');
    });

    it('应在请求期间设置 isLoading 为 true', async () => {
      let resolvePromise: (value: { data: NotificationSetting[] }) => void;
      vi.mocked(apiClient.get).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePromise = resolve;
          }),
      );

      const store = useNotificationsStore();
      const promise = store.fetchSettings();

      expect(store.isLoading).toBe(true);

      resolvePromise!({ data: [] });
      await promise;

      expect(store.isLoading).toBe(false);
    });
  });

  describe('addSetting', () => {
    it('应该成功添加通知设置并返回新设置', async () => {
      const newSetting = createMockSetting({ id: 10 });
      const settingData = createMockSettingData();
      vi.mocked(apiClient.post).mockResolvedValue({ data: newSetting });

      const store = useNotificationsStore();
      const result = await store.addSetting(settingData);

      expect(apiClient.post).toHaveBeenCalledWith('/notifications', settingData);
      expect(result).toEqual(newSetting);
      expect(store.settings).toContainEqual(newSetting);
    });

    it('添加失败时应返回 null 并设置错误信息', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('添加失败'));

      const store = useNotificationsStore();
      const result = await store.addSetting(createMockSettingData());

      expect(result).toBeNull();
      expect(store.error).toBe('添加失败');
      expect(store.isLoading).toBe(false);
    });

    it('添加失败时应调用 extractErrorMessage', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('权限不足'));

      const store = useNotificationsStore();
      await store.addSetting(createMockSettingData());

      expect(extractErrorMessage).toHaveBeenCalledWith(expect.any(Error), '添加通知设置失败');
    });

    it('多次添加应正确追加到 settings', async () => {
      const setting1 = createMockSetting({ id: 10 });
      const setting2 = createMockSetting({ id: 11, channel_type: 'email' });
      vi.mocked(apiClient.post)
        .mockResolvedValueOnce({ data: setting1 })
        .mockResolvedValueOnce({ data: setting2 });

      const store = useNotificationsStore();
      await store.addSetting(createMockSettingData());
      await store.addSetting(createMockSettingData({ channel_type: 'email' }));

      expect(store.settings).toHaveLength(2);
    });
  });

  describe('updateSetting', () => {
    it('应该成功更新已存在的设置', async () => {
      const existingSetting = createMockSetting({ id: 1, name: '旧名称' });
      const updatedSetting = createMockSetting({ id: 1, name: '新名称' });
      vi.mocked(apiClient.put).mockResolvedValue({ data: updatedSetting });

      const store = useNotificationsStore();
      store.settings = [existingSetting];

      const result = await store.updateSetting(1, { name: '新名称' });

      expect(apiClient.put).toHaveBeenCalledWith('/notifications/1', { name: '新名称' });
      expect(result).toEqual(updatedSetting);
      expect(store.settings[0].name).toBe('新名称');
    });

    it('更新不存在的设置时应追加到列表', async () => {
      const newSetting = createMockSetting({ id: 99 });
      vi.mocked(apiClient.put).mockResolvedValue({ data: newSetting });

      const store = useNotificationsStore();
      store.settings = [];

      const result = await store.updateSetting(99, { name: '远程设置' });

      expect(result).toEqual(newSetting);
      expect(store.settings).toContainEqual(newSetting);
    });

    it('更新失败时应返回 null 并设置错误信息', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('更新失败'));

      const store = useNotificationsStore();
      const result = await store.updateSetting(1, { name: '新名称' });

      expect(result).toBeNull();
      expect(store.error).toBe('更新失败');
    });

    it('更新失败时应调用 extractErrorMessage', async () => {
      vi.mocked(apiClient.put).mockRejectedValue(new Error('冲突'));

      const store = useNotificationsStore();
      await store.updateSetting(1, { name: '新名称' });

      expect(extractErrorMessage).toHaveBeenCalledWith(expect.any(Error), '更新通知设置失败');
    });
  });

  describe('deleteSetting', () => {
    it('应该成功删除设置并从列表中移除', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({});

      const store = useNotificationsStore();
      store.settings = [createMockSetting({ id: 1 }), createMockSetting({ id: 2 })];

      const result = await store.deleteSetting(1);

      expect(apiClient.delete).toHaveBeenCalledWith('/notifications/1');
      expect(result).toBe(true);
      expect(store.settings).toHaveLength(1);
      expect(store.settings[0].id).toBe(2);
    });

    it('删除失败时应返回 false 并设置错误信息', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('删除失败'));

      const store = useNotificationsStore();
      const result = await store.deleteSetting(1);

      expect(result).toBe(false);
      expect(store.error).toBe('删除失败');
    });

    it('删除失败时应调用 extractErrorMessage', async () => {
      vi.mocked(apiClient.delete).mockRejectedValue(new Error('权限拒绝'));

      const store = useNotificationsStore();
      await store.deleteSetting(1);

      expect(extractErrorMessage).toHaveBeenCalledWith(expect.any(Error), '删除通知设置失败');
    });

    it('删除不存在的 id 不应影响其他设置', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({});

      const store = useNotificationsStore();
      store.settings = [createMockSetting({ id: 1 })];

      const result = await store.deleteSetting(999);

      expect(result).toBe(true);
      expect(store.settings).toHaveLength(1);
    });
  });

  describe('testSetting', () => {
    it('测试成功时应返回 success 和 message', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: { success: true, message: '发送成功' } });

      const store = useNotificationsStore();
      const result = await store.testSetting(1, {} as NotificationChannelConfig);

      expect(apiClient.post).toHaveBeenCalledWith('/notifications/1/test');
      expect(result).toEqual({ success: true, message: '发送成功' });
    });

    it('后端返回 success=false 时应原样透传', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: false, message: '发送失败' },
      });

      const store = useNotificationsStore();
      const result = await store.testSetting(1, {} as NotificationChannelConfig);

      expect(result).toEqual({ success: false, message: '发送失败' });
    });

    it('后端未返回 message 时应使用默认消息', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: {} });

      const store = useNotificationsStore();
      const result = await store.testSetting(1, {} as NotificationChannelConfig);

      expect(result).toEqual({ success: true, message: '' });
    });

    it('后端返回 success=false 且没有 message 时不应回退为成功文案', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: false },
      });

      const store = useNotificationsStore();
      const result = await store.testSetting(1, {} as NotificationChannelConfig);

      expect(result).toEqual({ success: false, message: '' });
    });

    it('测试失败时应抛出异常', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('测试失败'));

      const store = useNotificationsStore();

      await expect(store.testSetting(1, {} as NotificationChannelConfig)).rejects.toThrow(
        '测试失败',
      );
    });

    it('测试失败时不应设置全局 error', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('测试失败'));

      const store = useNotificationsStore();

      try {
        await store.testSetting(1, {} as NotificationChannelConfig);
      } catch {
        // 预期抛出异常
      }

      expect(store.error).toBeNull();
    });

    it('测试前应清除之前的错误状态', async () => {
      vi.mocked(apiClient.post).mockRejectedValueOnce(new Error('旧错误'));

      const store = useNotificationsStore();
      store.error = '旧错误';

      // 第一次调用失败
      try {
        await store.testSetting(1, {} as NotificationChannelConfig);
      } catch {
        // 预期
      }

      // 第二次调用成功，应清除 error
      vi.mocked(apiClient.post).mockResolvedValue({ data: { message: '成功' } });
      await store.testSetting(1, {} as NotificationChannelConfig);

      expect(store.error).toBeNull();
    });
  });

  describe('testUnsavedSetting', () => {
    it('测试未保存设置成功时应返回 success 和 message', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: true, message: '测试通过' },
      });

      const store = useNotificationsStore();
      const result = await store.testUnsavedSetting('webhook', {
        url: 'https://example.com',
      });

      expect(apiClient.post).toHaveBeenCalledWith('/notifications/test-unsaved', {
        channel_type: 'webhook',
        config: { url: 'https://example.com' },
      });
      expect(result).toEqual({ success: true, message: '测试通过' });
    });

    it('后端返回 success=false 时应原样透传', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({
        data: { success: false, message: '测试失败' },
      });

      const store = useNotificationsStore();
      const result = await store.testUnsavedSetting('email', { to: 'test@test.com' });

      expect(result).toEqual({ success: false, message: '测试失败' });
    });

    it('后端未返回 message 时应交由组件层决定默认文案', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: {} });

      const store = useNotificationsStore();
      const result = await store.testUnsavedSetting('email', { to: 'test@test.com' });

      expect(result).toEqual({ success: true, message: '' });
    });

    it('测试失败时应抛出异常', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('连接超时'));

      const store = useNotificationsStore();

      await expect(
        store.testUnsavedSetting('telegram', { botToken: 'token', chatId: '123' }),
      ).rejects.toThrow('连接超时');
    });

    it('测试失败时不应设置全局 error', async () => {
      vi.mocked(apiClient.post).mockRejectedValue(new Error('超时'));

      const store = useNotificationsStore();

      try {
        await store.testUnsavedSetting('webhook', { url: 'https://example.com' });
      } catch {
        // 预期
      }

      expect(store.error).toBeNull();
    });

    it('测试前应清除之前的错误状态', async () => {
      const store = useNotificationsStore();
      store.error = '旧错误';

      vi.mocked(apiClient.post).mockResolvedValue({ data: { message: '成功' } });
      await store.testUnsavedSetting('webhook', { url: 'https://example.com' });

      expect(store.error).toBeNull();
    });
  });

  describe('边界条件', () => {
    it('fetchSettings 返回空数组时 settings 应为空', async () => {
      vi.mocked(apiClient.get).mockResolvedValue({ data: [] });

      const store = useNotificationsStore();
      await store.fetchSettings();

      expect(store.settings).toEqual([]);
    });

    it('addSetting 后 isLoading 应为 false', async () => {
      vi.mocked(apiClient.post).mockResolvedValue({ data: createMockSetting({ id: 1 }) });

      const store = useNotificationsStore();
      await store.addSetting(createMockSettingData());

      expect(store.isLoading).toBe(false);
    });

    it('updateSetting 后 isLoading 应为 false', async () => {
      vi.mocked(apiClient.put).mockResolvedValue({ data: createMockSetting({ id: 1 }) });

      const store = useNotificationsStore();
      await store.updateSetting(1, { name: '更新' });

      expect(store.isLoading).toBe(false);
    });

    it('deleteSetting 后 isLoading 应为 false', async () => {
      vi.mocked(apiClient.delete).mockResolvedValue({});

      const store = useNotificationsStore();
      await store.deleteSetting(1);

      expect(store.isLoading).toBe(false);
    });

    it('多个 store 实例应共享同一份 state', () => {
      const store1 = useNotificationsStore();
      const store2 = useNotificationsStore();

      store1.settings = [createMockSetting({ id: 1 })];

      expect(store2.settings).toHaveLength(1);
    });

    it('updateSetting 替换元素时应保持数组长度不变', async () => {
      const setting1 = createMockSetting({ id: 1, name: 'A' });
      const setting2 = createMockSetting({ id: 2, name: 'B' });
      const updatedSetting = createMockSetting({ id: 1, name: 'A-更新' });
      vi.mocked(apiClient.put).mockResolvedValue({ data: updatedSetting });

      const store = useNotificationsStore();
      store.settings = [setting1, setting2];

      await store.updateSetting(1, { name: 'A-更新' });

      expect(store.settings).toHaveLength(2);
      expect(store.settings[0].name).toBe('A-更新');
      expect(store.settings[1].name).toBe('B');
    });

    it('非网络错误（非 Error 实例）应使用 fallback 消息', async () => {
      vi.mocked(apiClient.get).mockRejectedValue('字符串错误');
      vi.mocked(extractErrorMessage).mockReturnValue('获取通知设置失败');

      const store = useNotificationsStore();
      await store.fetchSettings();

      expect(store.error).toBe('获取通知设置失败');
    });
  });
});
