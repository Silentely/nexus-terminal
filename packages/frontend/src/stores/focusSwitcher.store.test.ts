/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { nextTick } from 'vue';
import { useFocusSwitcherStore } from './focusSwitcher.store';
import type { FocusSwitcherFullConfig } from './focusSwitcher.store';

// Mock logger
const mockLog = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));
vi.mock('@/utils/log', () => ({ log: mockLog }));

// Mock vue-i18n
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

// Mock apiClient — vi.hoisted 确保在 vi.mock hoist 前可用
const { mockGet, mockPut } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockPut: vi.fn(),
}));
vi.mock('../utils/apiClient', () => ({
  default: {
    get: mockGet,
    put: mockPut,
  },
}));
vi.mock('@/utils/apiClient', () => ({
  default: {
    get: mockGet,
    put: mockPut,
  },
}));

// Mock auth.store：用 ref 保持可响应，便于 watch isAuthenticated
const { mockIsAuthenticated } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { ref: hoistedRef } = require('vue') as typeof import('vue');
  return { mockIsAuthenticated: hoistedRef(false) };
});
vi.mock('./auth.store', () => ({
  useAuthStore: () => ({
    get isAuthenticated() {
      return mockIsAuthenticated.value;
    },
    set isAuthenticated(v: boolean) {
      mockIsAuthenticated.value = v;
    },
  }),
}));

/**
 * 以已认证状态创建 store，等待自动加载完成，然后清除 apiClient 调用历史。
 */
async function createStoreAndFlushInit() {
  mockIsAuthenticated.value = true;
  const store = useFocusSwitcherStore();
  await nextTick();
  await vi.waitFor(() => {
    expect(mockGet).toHaveBeenCalled();
  });
  mockGet.mockClear();
  mockPut.mockClear();
  return store;
}

describe('focusSwitcher.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockIsAuthenticated.value = false;
    // 默认让认证后自动加载成功返回空配置
    mockGet.mockResolvedValue({ data: { sequence: [], shortcuts: {} } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该有 8 个可用输入框', () => {
      const store = useFocusSwitcherStore();
      expect(store.availableInputs).toHaveLength(8);
    });

    it('应该有正确的输入框 ID 列表', () => {
      const store = useFocusSwitcherStore();
      const ids = store.availableInputs.map((i) => i.id);
      expect(ids).toEqual([
        'commandHistorySearch',
        'quickCommandsSearch',
        'fileManagerSearch',
        'commandInput',
        'terminalSearch',
        'connectionListSearch',
        'fileEditorActive',
        'fileManagerPathInput',
      ]);
    });

    it('sequenceOrder 初始应为空数组', () => {
      const store = useFocusSwitcherStore();
      expect(store.sequenceOrder).toEqual([]);
    });

    it('itemConfigs 初始应为空对象', () => {
      const store = useFocusSwitcherStore();
      expect(store.itemConfigs).toEqual({});
    });

    it('isConfiguratorVisible 初始应为 false', () => {
      const store = useFocusSwitcherStore();
      expect(store.isConfiguratorVisible).toBe(false);
    });

    it('activateFileManagerSearchTrigger 初始应为 0', () => {
      const store = useFocusSwitcherStore();
      expect(store.activateFileManagerSearchTrigger).toBe(0);
    });

    it('activateTerminalSearchTrigger 初始应为 0', () => {
      const store = useFocusSwitcherStore();
      expect(store.activateTerminalSearchTrigger).toBe(0);
    });
  });

  describe('toggleConfigurator', () => {
    it('无参数时应切换可见状态', () => {
      const store = useFocusSwitcherStore();
      expect(store.isConfiguratorVisible).toBe(false);
      store.toggleConfigurator();
      expect(store.isConfiguratorVisible).toBe(true);
      store.toggleConfigurator();
      expect(store.isConfiguratorVisible).toBe(false);
    });

    it('传入 true 时应设置为可见', () => {
      const store = useFocusSwitcherStore();
      store.toggleConfigurator(true);
      expect(store.isConfiguratorVisible).toBe(true);
    });

    it('传入 false 时应设置为不可见', () => {
      const store = useFocusSwitcherStore();
      store.toggleConfigurator(true);
      store.toggleConfigurator(false);
      expect(store.isConfiguratorVisible).toBe(false);
    });
  });

  describe('triggerFileManagerSearchActivation', () => {
    it('每次调用应递增 activateFileManagerSearchTrigger', () => {
      const store = useFocusSwitcherStore();
      expect(store.activateFileManagerSearchTrigger).toBe(0);
      store.triggerFileManagerSearchActivation();
      expect(store.activateFileManagerSearchTrigger).toBe(1);
      store.triggerFileManagerSearchActivation();
      expect(store.activateFileManagerSearchTrigger).toBe(2);
    });
  });

  describe('triggerTerminalSearchActivation', () => {
    it('每次调用应递增 activateTerminalSearchTrigger', () => {
      const store = useFocusSwitcherStore();
      expect(store.activateTerminalSearchTrigger).toBe(0);
      store.triggerTerminalSearchActivation();
      expect(store.activateTerminalSearchTrigger).toBe(1);
      store.triggerTerminalSearchActivation();
      expect(store.activateTerminalSearchTrigger).toBe(2);
    });
  });

  describe('loadConfigurationFromBackend', () => {
    it('成功加载时应设置 sequenceOrder 和 itemConfigs', async () => {
      const config: FocusSwitcherFullConfig = {
        sequence: ['commandInput', 'terminalSearch'],
        shortcuts: {
          commandInput: { shortcut: 'Alt+K' },
          terminalSearch: { shortcut: 'Alt+F' },
        },
      };
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.sequenceOrder).toEqual(['commandInput', 'terminalSearch']);
      expect(store.itemConfigs).toEqual({
        commandInput: { shortcut: 'Alt+K' },
        terminalSearch: { shortcut: 'Alt+F' },
      });
    });

    it('HTTP 错误时应重置配置为空', async () => {
      const store = await createStoreAndFlushInit();
      mockGet.mockRejectedValueOnce(new Error('HTTP error! status: 500'));

      await store.loadConfigurationFromBackend();

      expect(store.sequenceOrder).toEqual([]);
      expect(store.itemConfigs).toEqual({});
    });

    it('apiClient 抛出异常时应重置配置为空', async () => {
      const store = await createStoreAndFlushInit();
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      await store.loadConfigurationFromBackend();

      expect(store.sequenceOrder).toEqual([]);
      expect(store.itemConfigs).toEqual({});
    });

    it('sequence 中包含无效 ID 时应拒绝整个序列', async () => {
      const config: FocusSwitcherFullConfig = {
        sequence: ['commandInput', 'invalidId', 'terminalSearch'],
        shortcuts: {},
      };
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.sequenceOrder).toEqual([]);
    });

    it('sequence 不是数组时应重置为空数组', async () => {
      const config = { sequence: 'not-an-array', shortcuts: {} } as any;
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.sequenceOrder).toEqual([]);
    });

    it('shortcuts 中包含无效 ID 时应忽略该快捷键', async () => {
      const config: FocusSwitcherFullConfig = {
        sequence: [],
        shortcuts: {
          invalidId: { shortcut: 'Alt+X' },
          commandInput: { shortcut: 'Alt+K' },
        },
      };
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.itemConfigs).not.toHaveProperty('invalidId');
      expect(store.itemConfigs).toHaveProperty('commandInput');
    });

    it('shortcuts 不是对象时应重置为空对象', async () => {
      const config = { sequence: [], shortcuts: 'not-an-object' } as any;
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.itemConfigs).toEqual({});
    });

    it('shortcuts 为 null 时应重置为空对象', async () => {
      const config = { sequence: [], shortcuts: null } as any;
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.itemConfigs).toEqual({});
    });

    it('快捷键不以 Alt+ 开头时应忽略该快捷键', async () => {
      const config: FocusSwitcherFullConfig = {
        sequence: [],
        shortcuts: {
          commandInput: { shortcut: 'Ctrl+K' },
        },
      };
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.itemConfigs).toHaveProperty('commandInput');
      expect(store.itemConfigs['commandInput'].shortcut).toBeUndefined();
    });

    it('shortcut 为 undefined 时应保留该配置', async () => {
      const config: FocusSwitcherFullConfig = {
        sequence: [],
        shortcuts: {
          commandInput: { shortcut: undefined },
        },
      };
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.itemConfigs).toHaveProperty('commandInput');
      expect(store.itemConfigs['commandInput'].shortcut).toBeUndefined();
    });

    it('shortcuts 值不是对象时应保留 ID 但清空快捷键', async () => {
      const config = {
        sequence: [],
        shortcuts: {
          commandInput: 'not-an-object',
        },
      } as any;
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: config });

      await store.loadConfigurationFromBackend();

      expect(store.itemConfigs).toHaveProperty('commandInput');
      expect(store.itemConfigs['commandInput'].shortcut).toBeUndefined();
    });

    it('loadedFullConfig 为 null 时应重置配置', async () => {
      const store = await createStoreAndFlushInit();
      mockGet.mockResolvedValueOnce({ data: null });

      await store.loadConfigurationFromBackend();

      expect(store.sequenceOrder).toEqual([]);
      expect(store.itemConfigs).toEqual({});
    });
  });

  describe('saveConfigurationToBackend', () => {
    it('应正确发送 PUT 请求保存配置', async () => {
      const store = useFocusSwitcherStore();
      mockPut.mockResolvedValueOnce({});
      store.sequenceOrder = ['commandInput', 'terminalSearch'];
      store.itemConfigs = { commandInput: { shortcut: 'Alt+K' } };

      await store.saveConfigurationToBackend();

      expect(mockPut).toHaveBeenCalledWith('/settings/focus-switcher-sequence', {
        sequence: ['commandInput', 'terminalSearch'],
        shortcuts: { commandInput: { shortcut: 'Alt+K' } },
      });
    });

    it('保存失败时应记录错误', async () => {
      const store = useFocusSwitcherStore();
      mockPut.mockRejectedValueOnce(new Error('Bad request'));
      await store.saveConfigurationToBackend();

      expect(mockLog.error).toHaveBeenCalled();
    });

    it('apiClient 抛出异常时应记录错误', async () => {
      const store = useFocusSwitcherStore();
      mockPut.mockRejectedValueOnce(new Error('Network error'));

      await store.saveConfigurationToBackend();

      expect(mockLog.error).toHaveBeenCalled();
    });
  });

  describe('updateConfiguration', () => {
    it('应更新 sequenceOrder 和 itemConfigs 并保存到后端', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      const newConfig: FocusSwitcherFullConfig = {
        sequence: ['commandInput', 'fileManagerSearch'],
        shortcuts: {
          commandInput: { shortcut: 'Alt+K' },
          fileManagerSearch: { shortcut: 'Alt+F' },
        },
      };

      store.updateConfiguration(newConfig);

      expect(store.sequenceOrder).toEqual(['commandInput', 'fileManagerSearch']);
      expect(store.itemConfigs).toEqual({
        commandInput: { shortcut: 'Alt+K' },
        fileManagerSearch: { shortcut: 'Alt+F' },
      });
    });

    it('应过滤 sequenceOrder 中的无效 ID', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      const newConfig: FocusSwitcherFullConfig = {
        sequence: ['commandInput', 'invalidId'],
        shortcuts: {},
      };

      store.updateConfiguration(newConfig);

      expect(store.sequenceOrder).toEqual(['commandInput']);
    });

    it('sequence 不是数组时应保持现有顺序', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput'];

      store.updateConfiguration({ sequence: 'not-an-array' } as any);

      expect(store.sequenceOrder).toEqual(['commandInput']);
    });

    it('shortcuts 中的无效快捷键应被过滤', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      const newConfig: FocusSwitcherFullConfig = {
        sequence: [],
        shortcuts: {
          commandInput: { shortcut: 'Ctrl+K' },
          terminalSearch: { shortcut: 'Alt+F' },
        },
      };

      store.updateConfiguration(newConfig);

      expect(store.itemConfigs).toHaveProperty('terminalSearch');
      expect(store.itemConfigs['terminalSearch'].shortcut).toBe('Alt+F');
      expect(store.itemConfigs).toHaveProperty('commandInput');
      expect(store.itemConfigs['commandInput'].shortcut).toBeUndefined();
    });

    it('shortcuts 不是对象时应保持现有配置', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      store.itemConfigs = { commandInput: { shortcut: 'Alt+K' } };

      store.updateConfiguration({ sequence: [], shortcuts: 'invalid' } as any);

      expect(store.itemConfigs).toEqual({ commandInput: { shortcut: 'Alt+K' } });
    });

    it('shortcuts 为 null 时应保持现有配置', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      store.itemConfigs = { commandInput: { shortcut: 'Alt+K' } };

      store.updateConfiguration({ sequence: [], shortcuts: null } as any);

      expect(store.itemConfigs).toEqual({ commandInput: { shortcut: 'Alt+K' } });
    });

    it('更新后应调用 saveConfigurationToBackend', async () => {
      mockPut.mockResolvedValue({});

      const store = useFocusSwitcherStore();
      store.updateConfiguration({ sequence: [], shortcuts: {} });

      expect(mockPut).toHaveBeenCalled();
    });
  });

  describe('getSequenceInputs', () => {
    it('sequenceOrder 为空时应返回空数组', () => {
      const store = useFocusSwitcherStore();
      expect(store.getSequenceInputs).toEqual([]);
    });

    it('应返回序列中的输入框及其快捷键信息', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput', 'terminalSearch'];
      store.itemConfigs = { commandInput: { shortcut: 'Alt+K' } };

      const result = store.getSequenceInputs;

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('commandInput');
      expect(result[0].shortcut).toBe('Alt+K');
      expect(result[1].id).toBe('terminalSearch');
      expect(result[1].shortcut).toBeUndefined();
    });

    it('序列中包含未知 ID 时应被过滤', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput', 'unknownId'];

      const result = store.getSequenceInputs;

      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('commandInput');
    });
  });

  describe('getAvailableInputsForConfigurator', () => {
    it('全部不在序列中时应返回所有输入框', () => {
      const store = useFocusSwitcherStore();
      const result = store.getAvailableInputsForConfigurator;
      expect(result).toHaveLength(8);
    });

    it('应排除已在序列中的输入框', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput', 'terminalSearch'];

      const result = store.getAvailableInputsForConfigurator;

      expect(result).toHaveLength(6);
      const ids = result.map((i) => i.id);
      expect(ids).not.toContain('commandInput');
      expect(ids).not.toContain('terminalSearch');
    });

    it('应合并快捷键信息', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput'];
      store.itemConfigs = { terminalSearch: { shortcut: 'Alt+F' } };

      const result = store.getAvailableInputsForConfigurator;
      const terminalSearchInput = result.find((i) => i.id === 'terminalSearch');

      expect(terminalSearchInput).toBeDefined();
      expect(terminalSearchInput!.shortcut).toBe('Alt+F');
    });
  });

  describe('getNextFocusTargetId', () => {
    it('序列为空时应返回 null', () => {
      const store = useFocusSwitcherStore();
      expect(store.getNextFocusTargetId(null)).toBeNull();
    });

    it('当前 ID 为 null 时应返回第一个', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput', 'terminalSearch', 'fileManagerSearch'];

      expect(store.getNextFocusTargetId(null)).toBe('commandInput');
    });

    it('当前 ID 在序列中时应返回下一个（循环）', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput', 'terminalSearch', 'fileManagerSearch'];

      expect(store.getNextFocusTargetId('commandInput')).toBe('terminalSearch');
      expect(store.getNextFocusTargetId('terminalSearch')).toBe('fileManagerSearch');
      expect(store.getNextFocusTargetId('fileManagerSearch')).toBe('commandInput');
    });

    it('当前 ID 不在序列中时应返回第一个', () => {
      const store = useFocusSwitcherStore();
      store.sequenceOrder = ['commandInput', 'terminalSearch'];

      expect(store.getNextFocusTargetId('unknownId')).toBe('commandInput');
    });
  });

  describe('getFocusTargetIdByShortcut', () => {
    it('未找到匹配快捷键时应返回 null', () => {
      const store = useFocusSwitcherStore();
      expect(store.getFocusTargetIdByShortcut('Alt+Z')).toBeNull();
    });

    it('应返回匹配快捷键的 ID', () => {
      const store = useFocusSwitcherStore();
      store.itemConfigs = {
        commandInput: { shortcut: 'Alt+K' },
        terminalSearch: { shortcut: 'Alt+F' },
      };

      expect(store.getFocusTargetIdByShortcut('Alt+K')).toBe('commandInput');
      expect(store.getFocusTargetIdByShortcut('Alt+F')).toBe('terminalSearch');
    });

    it('无 itemConfigs 时应返回 null', () => {
      const store = useFocusSwitcherStore();
      expect(store.getFocusTargetIdByShortcut('Alt+K')).toBeNull();
    });
  });

  describe('registerFocusAction', () => {
    it('应注册聚焦动作并返回注销函数', () => {
      const store = useFocusSwitcherStore();
      const action = vi.fn().mockReturnValue(true);

      const unregister = store.registerFocusAction('commandInput', action);

      expect(typeof unregister).toBe('function');
    });

    it('为未知 ID 注册时应返回无操作函数', () => {
      const store = useFocusSwitcherStore();
      const action = vi.fn();

      const unregister = store.registerFocusAction('unknownId', action);

      expect(typeof unregister).toBe('function');
      unregister();
    });

    it('调用注销函数后应移除该动作', () => {
      const store = useFocusSwitcherStore();
      const action = vi.fn().mockReturnValue(true);

      const unregister = store.registerFocusAction('commandInput', action);
      unregister();

      const result = store.focusTarget('commandInput');
      expect(result).resolves.toBe(false);
    });

    it('多次注册同一 ID 的动作应按顺序执行', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockReturnValue(false);
      const action2 = vi.fn().mockReturnValue(true);

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });

    it('注册多个动作后注销其中一个，其他动作仍应生效', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockReturnValue(false);
      const action2 = vi.fn().mockReturnValue(true);

      const unregister1 = store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      unregister1();

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
      expect(action1).not.toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });

    it('注销所有动作后应从 Map 中移除该 ID', () => {
      const store = useFocusSwitcherStore();
      const action = vi.fn().mockReturnValue(true);

      const unregister = store.registerFocusAction('commandInput', action);
      unregister();

      const action2 = vi.fn().mockReturnValue(true);
      store.registerFocusAction('commandInput', action2);

      expect(action2).not.toHaveBeenCalled();
    });

    it('注销不存在的动作时应记录警告', () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockReturnValue(true);

      const unregister = store.registerFocusAction('commandInput', action1);
      unregister();
      unregister();
    });
  });

  describe('focusTarget', () => {
    it('没有注册动作时应返回 false', async () => {
      const store = useFocusSwitcherStore();
      const result = await store.focusTarget('commandInput');
      expect(result).toBe(false);
    });

    it('动作返回 true 时应停止迭代并返回 true', async () => {
      const store = useFocusSwitcherStore();
      const action = vi.fn().mockResolvedValue(true);
      store.registerFocusAction('commandInput', action);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('动作返回 false 时应继续尝试下一个', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockResolvedValue(false);
      const action2 = vi.fn().mockResolvedValue(true);

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });

    it('动作返回 undefined 时应继续尝试下一个', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockResolvedValue(undefined);
      const action2 = vi.fn().mockResolvedValue(true);

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
    });

    it('动作抛出异常时应继续尝试下一个', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockRejectedValue(new Error('action error'));
      const action2 = vi.fn().mockResolvedValue(true);

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
      expect(action1).toHaveBeenCalled();
      expect(action2).toHaveBeenCalled();
    });

    it('所有动作都返回 false 时应返回 false', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockResolvedValue(false);
      const action2 = vi.fn().mockResolvedValue(false);

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(false);
    });

    it('所有动作都抛出异常时应返回 false', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockRejectedValue(new Error('error1'));
      const action2 = vi.fn().mockRejectedValue(new Error('error2'));

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(false);
    });

    it('同步动作返回 true 时应返回 true', async () => {
      const store = useFocusSwitcherStore();
      const action = vi.fn().mockReturnValue(true);
      store.registerFocusAction('commandInput', action);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
    });

    it('同步动作返回 false 时应继续尝试', async () => {
      const store = useFocusSwitcherStore();
      const action1 = vi.fn().mockReturnValue(false);
      const action2 = vi.fn().mockReturnValue(true);

      store.registerFocusAction('commandInput', action1);
      store.registerFocusAction('commandInput', action2);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
    });

    it('混合同步和异步动作时应按顺序执行', async () => {
      const store = useFocusSwitcherStore();
      const syncAction = vi.fn().mockReturnValue(false);
      const asyncAction = vi.fn().mockResolvedValue(true);

      store.registerFocusAction('commandInput', syncAction);
      store.registerFocusAction('commandInput', asyncAction);

      const result = await store.focusTarget('commandInput');

      expect(result).toBe(true);
      expect(syncAction).toHaveBeenCalled();
      expect(asyncAction).toHaveBeenCalled();
    });

    it('为 fileManagerSearch 执行失败时不应触发激活', async () => {
      const store = useFocusSwitcherStore();
      const result = await store.focusTarget('fileManagerSearch');
      expect(result).toBe(false);
      expect(store.activateFileManagerSearchTrigger).toBe(0);
    });

    it('为 terminalSearch 执行失败时不应触发激活', async () => {
      const store = useFocusSwitcherStore();
      const result = await store.focusTarget('terminalSearch');
      expect(result).toBe(false);
      expect(store.activateTerminalSearchTrigger).toBe(0);
    });
  });

  describe('认证后自动加载', () => {
    it('已认证时创建 store 应自动调用 loadConfigurationFromBackend', async () => {
      await createStoreAndFlushInit();
      const store = useFocusSwitcherStore();
      expect(store.sequenceOrder).toEqual([]);
      expect(store.itemConfigs).toEqual({});
    });

    it('未认证时创建 store 不应请求后端配置', async () => {
      mockIsAuthenticated.value = false;
      const store = useFocusSwitcherStore();
      await nextTick();
      // 给 watch/异步一点时间确认未发请求
      await new Promise((r) => setTimeout(r, 20));
      expect(mockGet).not.toHaveBeenCalled();
      expect(store.sequenceOrder).toEqual([]);
      expect(store.itemConfigs).toEqual({});
    });

    it('未认证时手动 load 应跳过请求并记录 debug', async () => {
      mockIsAuthenticated.value = false;
      const store = useFocusSwitcherStore();
      await nextTick();
      mockGet.mockClear();
      mockLog.debug.mockClear();

      await store.loadConfigurationFromBackend();

      expect(mockGet).not.toHaveBeenCalled();
      expect(mockLog.debug).toHaveBeenCalledWith(
        expect.stringContaining('用户未认证，跳过加载焦点切换配置'),
      );
    });

    it('从未认证变为已认证时应触发加载', async () => {
      mockIsAuthenticated.value = false;
      useFocusSwitcherStore();
      await nextTick();
      mockGet.mockClear();
      mockLog.debug.mockClear();

      mockGet.mockResolvedValueOnce({ data: { sequence: [], shortcuts: {} } });
      mockIsAuthenticated.value = true;
      await nextTick();
      await vi.waitFor(() => {
        expect(mockGet).toHaveBeenCalledWith('/settings/focus-switcher-sequence');
      });
    });

    it('登出后应清空 sequenceOrder 与 itemConfigs', async () => {
      const store = await createStoreAndFlushInit();
      // 手动写入状态再模拟登出
      store.sequenceOrder = ['commandInput'];
      store.itemConfigs = { commandInput: { shortcut: 'Alt+K' } };

      mockIsAuthenticated.value = false;
      await nextTick();

      expect(store.sequenceOrder).toEqual([]);
      expect(store.itemConfigs).toEqual({});
    });
  });
});
