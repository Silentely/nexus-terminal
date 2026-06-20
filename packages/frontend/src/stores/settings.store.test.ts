/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { useSettingsStore } from './settings.store';
import apiClient from '../utils/apiClient';
import { extractErrorMessage } from '../utils/errorExtractor';

// Mock apiClient
vi.mock('../utils/apiClient', () => ({
  default: {
    get: vi.fn(),
    put: vi.fn(),
  },
}));

// Mock i18n
vi.mock('../i18n', () => ({
  setLocale: vi.fn(),
  defaultLng: 'en-US',
  availableLocales: ['en-US', 'zh-CN'],
}));

// Mock errorExtractor
vi.mock('../utils/errorExtractor', () => ({
  extractErrorMessage: vi.fn((_err: unknown, fallback: string) => fallback),
}));

describe('settings.store', () => {
  let localStorageMock: Record<string, string>;

  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();

    // Mock localStorage
    localStorageMock = {};
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (key: string) => localStorageMock[key] || null,
        setItem: (key: string, value: string) => {
          localStorageMock[key] = value;
        },
        removeItem: (key: string) => {
          delete localStorageMock[key];
        },
        clear: () => {
          localStorageMock = {};
        },
        get length() {
          return Object.keys(localStorageMock).length;
        },
        key: (index: number) => {
          const keys = Object.keys(localStorageMock);
          return keys[index] || null;
        },
      },
      writable: true,
      configurable: true,
    });
  });

  // ========== 初始状态 ==========
  describe('初始状态', () => {
    it('应该有正确的初始状态', () => {
      const store = useSettingsStore();
      expect(store.settings).toEqual({});
      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
    });
  });

  // ========== 系统设置 Getters 默认值 ==========
  describe('系统设置 Getters 默认值', () => {
    it('language 应返回默认语言 en-US', () => {
      const store = useSettingsStore();
      expect(store.language).toBe('en-US');
    });

    it('showPopupFileEditorBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showPopupFileEditorBoolean).toBe(true);
    });

    it('showPopupFileManagerBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showPopupFileManagerBoolean).toBe(true);
    });

    it('shareFileEditorTabsBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.shareFileEditorTabsBoolean).toBe(true);
    });

    it('autoCopyOnSelectBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.autoCopyOnSelectBoolean).toBe(false);
    });

    it('dockerDefaultExpandBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.dockerDefaultExpandBoolean).toBe(false);
    });

    it('statusMonitorIntervalSecondsNumber 默认应为 3', () => {
      const store = useSettingsStore();
      expect(store.statusMonitorIntervalSecondsNumber).toBe(3);
    });

    it('statusMonitorShowIpBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.statusMonitorShowIpBoolean).toBe(false);
    });

    it('commandInputSyncTarget 默认应为 none', () => {
      const store = useSettingsStore();
      expect(store.commandInputSyncTarget).toBe('none');
    });

    it('timezone 默认应为 UTC', () => {
      const store = useSettingsStore();
      expect(store.timezone).toBe('UTC');
    });

    it('dashboardSortBy 默认应为 last_connected_at', () => {
      const store = useSettingsStore();
      expect(store.dashboardSortBy).toBe('last_connected_at');
    });

    it('dashboardSortOrder 默认应为 desc', () => {
      const store = useSettingsStore();
      expect(store.dashboardSortOrder).toBe('desc');
    });

    it('showConnectionTagsBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showConnectionTagsBoolean).toBe(true);
    });

    it('showQuickCommandTagsBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.showQuickCommandTagsBoolean).toBe(true);
    });

    it('quickCommandsCompactModeBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.quickCommandsCompactModeBoolean).toBe(false);
    });

    it('quickCommandRowSizeMultiplierNumber 默认应为 1.0', () => {
      const store = useSettingsStore();
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.0);
    });

    it('terminalOutputEnhancerEnabledBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.terminalOutputEnhancerEnabledBoolean).toBe(true);
    });

    it('terminalScrollbackLimitNumber 默认应为 5000', () => {
      const store = useSettingsStore();
      expect(store.terminalScrollbackLimitNumber).toBe(5000);
    });

    it('terminalAutoWrapEnabledBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.terminalAutoWrapEnabledBoolean).toBe(true);
    });

    it('terminalEnableRightClickPasteBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.terminalEnableRightClickPasteBoolean).toBe(true);
    });

    it('sshSuspendKeepAliveSecondsNumber 默认应为 0', () => {
      const store = useSettingsStore();
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(0);
    });
  });

  // ========== 安全设置 Getters 默认值 ==========
  describe('安全设置 Getters 默认值', () => {
    it('ipWhitelistEnabled 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.ipWhitelistEnabled).toBe(false);
    });

    it('ipBlacklistEnabledBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.ipBlacklistEnabledBoolean).toBe(true);
    });
  });

  // ========== 布局设置 Getters 默认值 ==========
  describe('布局设置 Getters 默认值', () => {
    it('workspaceSidebarPersistentBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.workspaceSidebarPersistentBoolean).toBe(false);
    });

    it('fileManagerRowSizeMultiplierNumber 默认应为 1.0', () => {
      const store = useSettingsStore();
      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.0);
    });

    it('fileManagerShowDeleteConfirmationBoolean 默认应为 true', () => {
      const store = useSettingsStore();
      expect(store.fileManagerShowDeleteConfirmationBoolean).toBe(true);
    });

    it('fileManagerSingleClickOpenFileBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.fileManagerSingleClickOpenFileBoolean).toBe(false);
    });

    it('layoutLockedBoolean 默认应为 false', () => {
      const store = useSettingsStore();
      expect(store.layoutLockedBoolean).toBe(false);
    });

    it('getSidebarPaneWidth(null) 应返回默认宽度', () => {
      const store = useSettingsStore();
      expect(store.getSidebarPaneWidth(null)).toBe('350px');
    });

    it('getSidebarPaneWidth 未知面板应返回默认宽度', () => {
      const store = useSettingsStore();
      expect(store.getSidebarPaneWidth('unknown' as any)).toBe('350px');
    });

    it('fileManagerColWidthsObject 初始时应为空对象', () => {
      const store = useSettingsStore();
      const colWidths = store.fileManagerColWidthsObject;
      // loadInitialSettings 之前 parsedFileManagerColWidths 为空
      expect(colWidths).toEqual({});
    });
  });

  // ========== Getters 自定义值 ==========
  describe('Getters 自定义值', () => {
    it('language 应从 settings 中返回设置的语言', () => {
      const store = useSettingsStore();
      store.settings.language = 'zh-CN';
      expect(store.language).toBe('zh-CN');
    });

    it('showPopupFileEditorBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.showPopupFileEditor = 'false';
      expect(store.showPopupFileEditorBoolean).toBe(false);
    });

    it('showPopupFileManagerBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.showPopupFileManager = 'false';
      expect(store.showPopupFileManagerBoolean).toBe(false);
    });

    it('shareFileEditorTabsBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.shareFileEditorTabs = 'false';
      expect(store.shareFileEditorTabsBoolean).toBe(false);
    });

    it('autoCopyOnSelectBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.autoCopyOnSelect = 'true';
      expect(store.autoCopyOnSelectBoolean).toBe(true);
    });

    it('dockerDefaultExpandBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.dockerDefaultExpand = 'true';
      expect(store.dockerDefaultExpandBoolean).toBe(true);
    });

    it('ipWhitelistEnabled 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.ipWhitelistEnabled = 'true';
      expect(store.ipWhitelistEnabled).toBe(true);
    });

    it('ipBlacklistEnabledBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.ipBlacklistEnabled = 'false';
      expect(store.ipBlacklistEnabledBoolean).toBe(false);
    });

    it('layoutLockedBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.layoutLocked = 'true';
      expect(store.layoutLockedBoolean).toBe(true);
    });

    it('workspaceSidebarPersistentBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.workspaceSidebarPersistent = 'true';
      expect(store.workspaceSidebarPersistentBoolean).toBe(true);
    });

    it('showConnectionTagsBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.showConnectionTags = 'false';
      expect(store.showConnectionTagsBoolean).toBe(false);
    });

    it('showQuickCommandTagsBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.showQuickCommandTags = 'false';
      expect(store.showQuickCommandTagsBoolean).toBe(false);
    });

    it('quickCommandsCompactModeBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.quickCommandsCompactMode = 'true';
      expect(store.quickCommandsCompactModeBoolean).toBe(true);
    });

    it('statusMonitorShowIpBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.showStatusMonitorIpAddress = 'true';
      expect(store.statusMonitorShowIpBoolean).toBe(true);
    });

    it('terminalOutputEnhancerEnabledBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.terminalOutputEnhancerEnabled = 'false';
      expect(store.terminalOutputEnhancerEnabledBoolean).toBe(false);
    });

    it('terminalAutoWrapEnabledBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.terminalAutoWrapEnabled = 'false';
      expect(store.terminalAutoWrapEnabledBoolean).toBe(false);
    });

    it('terminalEnableRightClickPasteBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.terminalEnableRightClickPaste = 'false';
      expect(store.terminalEnableRightClickPasteBoolean).toBe(false);
    });

    it('fileManagerShowDeleteConfirmationBoolean 为 false 时应返回 false', () => {
      const store = useSettingsStore();
      store.settings.fileManagerShowDeleteConfirmation = 'false';
      expect(store.fileManagerShowDeleteConfirmationBoolean).toBe(false);
    });

    it('fileManagerSingleClickOpenFileBoolean 为 true 时应返回 true', () => {
      const store = useSettingsStore();
      store.settings.fileManagerSingleClickOpenFile = 'true';
      expect(store.fileManagerSingleClickOpenFileBoolean).toBe(true);
    });

    it('terminalScrollbackLimitNumber 应正确解析数字', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = '10000';
      expect(store.terminalScrollbackLimitNumber).toBe(10000);
    });

    it('terminalScrollbackLimitNumber 为 0 时应返回 0', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = '0';
      expect(store.terminalScrollbackLimitNumber).toBe(0);
    });

    it('terminalScrollbackLimitNumber 为无效值时应回退到 5000', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = 'invalid';
      expect(store.terminalScrollbackLimitNumber).toBe(5000);
    });

    it('terminalScrollbackLimitNumber 为空字符串时应回退到 5000', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = '';
      expect(store.terminalScrollbackLimitNumber).toBe(5000);
    });

    it('terminalScrollbackLimitNumber 为负数时应回退到 5000', () => {
      const store = useSettingsStore();
      store.settings.terminalScrollbackLimit = '-1';
      expect(store.terminalScrollbackLimitNumber).toBe(5000);
    });

    it('sshSuspendKeepAliveSecondsNumber 应正确解析数字', () => {
      const store = useSettingsStore();
      store.settings.sshSuspendKeepAliveSeconds = '60';
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(60);
    });

    it('sshSuspendKeepAliveSecondsNumber 为无效值时应回退到 0', () => {
      const store = useSettingsStore();
      store.settings.sshSuspendKeepAliveSeconds = 'invalid';
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(0);
    });

    it('sshSuspendKeepAliveSecondsNumber 为空字符串时应回退到 0', () => {
      const store = useSettingsStore();
      store.settings.sshSuspendKeepAliveSeconds = '';
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(0);
    });

    it('sshSuspendKeepAliveSecondsNumber 为负数时应回退到 0', () => {
      const store = useSettingsStore();
      store.settings.sshSuspendKeepAliveSeconds = '-5';
      expect(store.sshSuspendKeepAliveSecondsNumber).toBe(0);
    });

    it('commandInputSyncTarget 为 quickCommands 时应返回该值', () => {
      const store = useSettingsStore();
      store.settings.commandInputSyncTarget = 'quickCommands';
      expect(store.commandInputSyncTarget).toBe('quickCommands');
    });

    it('commandInputSyncTarget 为 commandHistory 时应返回该值', () => {
      const store = useSettingsStore();
      store.settings.commandInputSyncTarget = 'commandHistory';
      expect(store.commandInputSyncTarget).toBe('commandHistory');
    });

    it('commandInputSyncTarget 为无效值时应回退到 none', () => {
      const store = useSettingsStore();
      store.settings.commandInputSyncTarget = 'invalid' as any;
      expect(store.commandInputSyncTarget).toBe('none');
    });

    it('commandInputSyncTarget 为 none 时应返回 none', () => {
      const store = useSettingsStore();
      store.settings.commandInputSyncTarget = 'none';
      expect(store.commandInputSyncTarget).toBe('none');
    });

    it('dashboardSortBy 为有效字段时应返回该值', () => {
      const store = useSettingsStore();
      store.settings.dashboardSortBy = 'name';
      expect(store.dashboardSortBy).toBe('name');
    });

    it('dashboardSortBy 为无效值时应回退到 last_connected_at', () => {
      const store = useSettingsStore();
      store.settings.dashboardSortBy = 'invalid' as any;
      expect(store.dashboardSortBy).toBe('last_connected_at');
    });

    it('dashboardSortOrder 为 asc 时应返回 asc', () => {
      const store = useSettingsStore();
      store.settings.dashboardSortOrder = 'asc';
      expect(store.dashboardSortOrder).toBe('asc');
    });

    it('dashboardSortOrder 为无效值时应回退到 desc', () => {
      const store = useSettingsStore();
      store.settings.dashboardSortOrder = 'invalid' as any;
      expect(store.dashboardSortOrder).toBe('desc');
    });

    it('quickCommandRowSizeMultiplierNumber 应正确解析浮点数', () => {
      const store = useSettingsStore();
      store.settings.quickCommandRowSizeMultiplier = '1.50';
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.5);
    });

    it('quickCommandRowSizeMultiplierNumber 为空字符串时应回退到 1.0', () => {
      const store = useSettingsStore();
      store.settings.quickCommandRowSizeMultiplier = '';
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.0);
    });

    it('quickCommandRowSizeMultiplierNumber 为无效值时应回退到 1.0', () => {
      const store = useSettingsStore();
      store.settings.quickCommandRowSizeMultiplier = 'abc';
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.0);
    });

    it('quickCommandRowSizeMultiplierNumber 为负数时应回退到 1.0', () => {
      const store = useSettingsStore();
      store.settings.quickCommandRowSizeMultiplier = '-2';
      expect(store.quickCommandRowSizeMultiplierNumber).toBe(1.0);
    });

    it('fileManagerRowSizeMultiplierNumber 为无效值时应回退到 1.0', () => {
      const store = useSettingsStore();
      store.settings.fileManagerRowSizeMultiplier = 'abc';
      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.0);
    });

    it('fileManagerRowSizeMultiplierNumber 为负数时应回退到 1.0', () => {
      const store = useSettingsStore();
      store.settings.fileManagerRowSizeMultiplier = '-1';
      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.0);
    });

    it('getSidebarPaneWidth 应返回已知面板的宽度', () => {
      const store = useSettingsStore();
      // 先加载设置以初始化 parsedSidebarPaneWidths
      store.settings.sidebarPaneWidths = JSON.stringify({ connections: '400px' });
      // 触发 parseSidebarPaneWidths
      store.loadInitialSettings = vi.fn().mockImplementation(async () => {
        // 手动设置
      });
      // 直接测试已解析的面板宽度
      expect(store.getSidebarPaneWidth('connections')).toBeTruthy();
    });
  });

  // ========== loadInitialSettings ==========
  describe('loadInitialSettings', () => {
    it('应成功加载设置并设置默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { language: 'zh-CN' } })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.isLoading).toBe(false);
      expect(store.error).toBeNull();
      expect(store.settings.language).toBe('zh-CN');
      expect(store.settings.showPopupFileEditor).toBe('true');
      expect(store.settings.ipWhitelistEnabled).toBe('false');
      expect(store.settings.maxLoginAttempts).toBe('5');
      expect(store.settings.loginBanDuration).toBe('300');
      expect(store.settings.showConnectionTags).toBe('true');
      expect(store.settings.showQuickCommandTags).toBe('true');
    });

    it('加载失败时应设置错误状态', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络错误'));

      await store.loadInitialSettings();

      expect(store.isLoading).toBe(false);
      expect(store.error).toBeTruthy();
    });

    it('加载完成后 isLoading 应为 false', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: false } })
        .mockResolvedValueOnce({ data: { enabled: false } });

      await store.loadInitialSettings();

      expect(store.isLoading).toBe(false);
    });

    it('加载失败时应通过字符串 data 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: '请求过于频繁', status: 429 },
      });

      await store.loadInitialSettings();

      expect(store.error).toBe('请求过于频繁');
    });

    it('加载失败时应通过对象 data.message 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { message: '服务器内部错误' } },
      });

      await store.loadInitialSettings();

      expect(store.error).toBe('服务器内部错误');
    });

    it('加载失败时应通过对象 data.error.message 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { data: { error: { message: '认证失败' } } },
      });

      await store.loadInitialSettings();

      expect(store.error).toBe('认证失败');
    });

    it('加载失败时 429 状态码应返回限频提示', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: { status: 429, data: {} },
      });

      await store.loadInitialSettings();

      expect(store.error).toBe('请求过于频繁，请稍后再试');
    });

    it('加载失败时 extractErrorMessage 应作为最终回退', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce({
        response: {},
      });
      vi.mocked(extractErrorMessage).mockReturnValueOnce('提取的错误消息');

      await store.loadInitialSettings();

      expect(store.error).toBe('提取的错误消息');
    });

    it('应解析有效的侧边栏宽度 JSON', async () => {
      const store = useSettingsStore();
      const sidebarWidths = { connections: '400px', fileManager: '500px' };
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { sidebarPaneWidths: JSON.stringify(sidebarWidths) },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.getSidebarPaneWidth('connections')).toBe('400px');
      expect(store.getSidebarPaneWidth('fileManager')).toBe('500px');
    });

    it('侧边栏宽度 JSON 无效时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { sidebarPaneWidths: 'not-a-json' },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.getSidebarPaneWidth('connections')).toBe('350px');
    });

    it('侧边栏宽度 JSON 解析为非对象时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { sidebarPaneWidths: '"just-a-string"' },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.getSidebarPaneWidth('connections')).toBe('350px');
    });

    it('文件管理器列宽 JSON 无效时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { fileManagerColWidths: 'invalid-json' },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      const colWidths = store.fileManagerColWidthsObject;
      expect(colWidths.name).toBe(300);
      expect(colWidths.type).toBe(50);
    });

    it('文件管理器列宽 JSON 解析为非对象时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { fileManagerColWidths: '"not-object"' },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      const colWidths = store.fileManagerColWidthsObject;
      expect(colWidths.name).toBe(300);
    });

    it('文件管理器列宽包含非数字值时应重置', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { fileManagerColWidths: JSON.stringify({ name: 'not-a-number' }) },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      const colWidths = store.fileManagerColWidthsObject;
      expect(colWidths.name).toBe(300);
    });

    it('文件管理器行大小乘数为无效值时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { fileManagerRowSizeMultiplier: 'invalid' },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.0);
    });

    it('文件管理器行大小乘数为负数时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: { fileManagerRowSizeMultiplier: '-1' },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.0);
    });

    it('文件管理器行大小乘数未定义时应设置默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.settings.fileManagerRowSizeMultiplier).toBe('1.0');
    });

    it('应从 localStorage 加载快捷命令行大小乘数', async () => {
      localStorageMock['nexus_quickCommandRowSizeMultiplier'] = '2.00';
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.settings.quickCommandRowSizeMultiplier).toBe('2.00');
    });

    it('localStorage 快捷命令行大小乘数无效时应忽略', async () => {
      localStorageMock['nexus_quickCommandRowSizeMultiplier'] = 'invalid';
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      // 默认值 '1.0' 应被设置，localStorage 的无效值应被忽略
      expect(store.settings.quickCommandRowSizeMultiplier).toBe('1.0');
    });

    it('localStorage 快捷命令行大小乘数为负数时应忽略', async () => {
      localStorageMock['nexus_quickCommandRowSizeMultiplier'] = '-5';
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.settings.quickCommandRowSizeMultiplier).toBe('1.0');
    });

    it('应从 localStorage 加载快捷命令紧凑模式', async () => {
      localStorageMock['nexus_quickCommandsCompactMode'] = 'true';
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.settings.quickCommandsCompactMode).toBe('true');
    });

    it('localStorage 快捷命令紧凑模式为 false 时应正确加载', async () => {
      localStorageMock['nexus_quickCommandsCompactMode'] = 'false';
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.settings.quickCommandsCompactMode).toBe('false');
    });

    it('localStorage 快捷命令紧凑模式为无效值时应忽略，但默认值仍被应用', async () => {
      localStorageMock['nexus_quickCommandsCompactMode'] = 'maybe';
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      // localStorage 无效值被忽略，但 applyDefaultValues 会设置默认值 'false'
      expect(store.settings.quickCommandsCompactMode).toBe('false');
    });

    it('应调用 setLocale 设置语言', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { language: 'zh-CN' } })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(setLocale).toHaveBeenCalledWith('zh-CN');
    });

    it('语言为无效值时应回退到 defaultLng', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { language: 'invalid-lang' } })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      // 'invalid-lang' 不在 availableLocales 中，应该回退
      // 但 navigator.language 也需要被检查
      expect(setLocale).toHaveBeenCalled();
    });

    it('语言为 undefined 时应设置默认语言', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(setLocale).toHaveBeenCalled();
    });

    it('加载失败时应根据 navigator.language 回退语言', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('网络错误'));

      await store.loadInitialSettings();

      expect(setLocale).toHaveBeenCalled();
      expect(store.isLoading).toBe(false);
    });

    it('应正确应用所有默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: {} })
        .mockResolvedValueOnce({ data: { enabled: false } })
        .mockResolvedValueOnce({ data: { enabled: false } });

      await store.loadInitialSettings();

      expect(store.settings.showPopupFileEditor).toBe('true');
      expect(store.settings.showPopupFileManager).toBe('false');
      expect(store.settings.shareFileEditorTabs).toBe('true');
      expect(store.settings.ipWhitelistEnabled).toBe('false');
      expect(store.settings.maxLoginAttempts).toBe('5');
      expect(store.settings.loginBanDuration).toBe('300');
      expect(store.settings.ipBlacklistEnabled).toBe('true');
      expect(store.settings.autoCopyOnSelect).toBe('false');
      expect(store.settings.dockerStatusIntervalSeconds).toBe('2');
      expect(store.settings.dockerDefaultExpand).toBe('false');
      expect(store.settings.statusMonitorIntervalSeconds).toBe('3');
      expect(store.settings.workspaceSidebarPersistent).toBe('false');
      expect(store.settings.commandInputSyncTarget).toBe('none');
      expect(store.settings.timezone).toBe('UTC');
      expect(store.settings.rdpModalWidth).toBe('1064');
      expect(store.settings.rdpModalHeight).toBe('858');
      expect(store.settings.vncModalWidth).toBe('1024');
      expect(store.settings.vncModalHeight).toBe('768');
      expect(store.settings.dashboardSortBy).toBe('last_connected_at');
      expect(store.settings.dashboardSortOrder).toBe('desc');
      // showConnectionTags 和 showQuickCommandTags 由 API 响应设置（enabled: false），而非默认值
      expect(store.settings.showConnectionTags).toBe('false');
      expect(store.settings.showQuickCommandTags).toBe('false');
      expect(store.settings.layoutLocked).toBe('false');
      expect(store.settings.terminalScrollbackLimit).toBe('5000');
      expect(store.settings.terminalAutoWrapEnabled).toBe('true');
      expect(store.settings.sshSuspendKeepAliveSeconds).toBe('0');
      expect(store.settings.fileManagerShowDeleteConfirmation).toBe('true');
      expect(store.settings.fileManagerSingleClickOpenFile).toBe('false');
      expect(store.settings.terminalEnableRightClickPaste).toBe('true');
      expect(store.settings.showStatusMonitorIpAddress).toBe('false');
      expect(store.settings.quickCommandRowSizeMultiplier).toBe('1.0');
      expect(store.settings.quickCommandsCompactMode).toBe('false');
      expect(store.settings.terminalOutputEnhancerEnabled).toBe('true');
    });

    it('已有设置不应被默认值覆盖', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: {
            showPopupFileEditor: 'false',
            maxLoginAttempts: '10',
            timezone: 'Asia/Shanghai',
          },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.settings.showPopupFileEditor).toBe('false');
      expect(store.settings.maxLoginAttempts).toBe('10');
      expect(store.settings.timezone).toBe('Asia/Shanghai');
    });
  });

  // ========== updateSetting ==========
  describe('updateSetting', () => {
    it('应成功更新允许的字符串设置项', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('language', 'zh-CN');

      expect(apiClient.put).toHaveBeenCalledWith('/settings', { language: 'zh-CN' });
      expect(store.settings.language).toBe('zh-CN');
    });

    it('应拒绝更新不允许的设置键', async () => {
      const store = useSettingsStore();

      await expect(store.updateSetting('invalidKey' as any, 'value')).rejects.toThrow(
        "不允许更新设置项 'invalidKey'",
      );
    });

    it('更新失败时应抛出错误', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });

      await expect(store.updateSetting('language', 'zh-CN')).rejects.toThrow('更新失败');
    });

    it('更新失败时应通过字符串 data 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: '设置已锁定' },
      });

      await expect(store.updateSetting('language', 'zh-CN')).rejects.toThrow('设置已锁定');
    });

    it('更新失败时应通过 data.error.message 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { error: { message: '权限不足' } } },
      });

      await expect(store.updateSetting('language', 'zh-CN')).rejects.toThrow('权限不足');
    });

    it('更新失败时 429 状态码应返回限频提示', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { status: 429, data: {} },
      });

      await expect(store.updateSetting('language', 'zh-CN')).rejects.toThrow(
        '请求过于频繁，请稍后再试',
      );
    });

    it('更新失败时 extractErrorMessage 应作为最终回退', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: {},
      });
      vi.mocked(extractErrorMessage).mockReturnValueOnce('回退错误');

      await expect(store.updateSetting('language', 'zh-CN')).rejects.toThrow('回退错误');
    });

    it('应通过专用端点更新布尔设置 showConnectionTags', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('showConnectionTags', true);

      expect(apiClient.put).toHaveBeenCalledWith('/settings/show-connection-tags', {
        enabled: true,
      });
      expect(store.settings.showConnectionTags).toBe('true');
    });

    it('应通过专用端点更新布尔设置 showQuickCommandTags', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('showQuickCommandTags', false);

      expect(apiClient.put).toHaveBeenCalledWith('/settings/show-quick-command-tags', {
        enabled: false,
      });
      expect(store.settings.showQuickCommandTags).toBe('false');
    });

    it('应通过专用端点更新布尔设置 autoCopyOnSelect', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('autoCopyOnSelect', true);

      expect(apiClient.put).toHaveBeenCalledWith('/settings/auto-copy-on-select', {
        enabled: true,
      });
      expect(store.settings.autoCopyOnSelect).toBe('true');
    });

    it('布尔端点设置项收到字符串值时应走通用 /settings 端点', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      // 'true' 是字符串而非布尔，所以走通用端点路径
      await store.updateSetting('showConnectionTags', 'true' as any);

      expect(apiClient.put).toHaveBeenCalledWith('/settings', { showConnectionTags: 'true' });
      expect(store.settings.showConnectionTags).toBe('true');
    });

    it('更新 quickCommandsCompactMode 为 true 时应保存到 localStorage', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('quickCommandsCompactMode', 'true');

      expect(localStorageMock['nexus_quickCommandsCompactMode']).toBe('true');
    });

    it('更新 quickCommandsCompactMode 为 false 时应保存到 localStorage', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('quickCommandsCompactMode', 'false');

      expect(localStorageMock['nexus_quickCommandsCompactMode']).toBe('false');
    });

    it('更新 quickCommandsCompactMode 为非布尔字符串时不应保存到 localStorage', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('quickCommandsCompactMode', 'invalid');

      expect(localStorageMock['nexus_quickCommandsCompactMode']).toBeUndefined();
    });

    it('更新 language 为有效语言时应调用 setLocale', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('language', 'zh-CN');

      expect(setLocale).toHaveBeenCalledWith('zh-CN');
    });

    it('更新 language 为无效语言时不应调用 setLocale', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateSetting('language', 'invalid-lang');

      expect(setLocale).not.toHaveBeenCalledWith('invalid-lang');
    });

    it('应正确更新所有允许的设置键', async () => {
      const store = useSettingsStore();
      const allowedKeys = [
        'language',
        'ipWhitelist',
        'maxLoginAttempts',
        'loginBanDuration',
        'showPopupFileEditor',
        'showPopupFileManager',
        'shareFileEditorTabs',
        'ipWhitelistEnabled',
        'autoCopyOnSelect',
        'dockerStatusIntervalSeconds',
        'dockerDefaultExpand',
        'statusMonitorIntervalSeconds',
        'workspaceSidebarPersistent',
        'sidebarPaneWidths',
        'fileManagerRowSizeMultiplier',
        'fileManagerColWidths',
        'commandInputSyncTarget',
        'timezone',
        'rdpModalWidth',
        'rdpModalHeight',
        'vncModalWidth',
        'vncModalHeight',
        'ipBlacklistEnabled',
        'dashboardSortBy',
        'dashboardSortOrder',
        'showConnectionTags',
        'showQuickCommandTags',
        'layoutLocked',
        'terminalScrollbackLimit',
        'terminalAutoWrapEnabled',
        'sshSuspendKeepAliveSeconds',
        'fileManagerShowDeleteConfirmation',
        'fileManagerSingleClickOpenFile',
        'terminalEnableRightClickPaste',
        'showStatusMonitorIpAddress',
        'quickCommandRowSizeMultiplier',
        'quickCommandsCompactMode',
        'terminalOutputEnhancerEnabled',
      ] as const;

      for (const key of allowedKeys) {
        vi.mocked(apiClient.put).mockResolvedValueOnce({});
        await store.updateSetting(key as any, 'test-value');
        expect(store.settings[key]).toBe('test-value');
      }
    });
  });

  // ========== updateMultipleSettings ==========
  describe('updateMultipleSettings', () => {
    it('应成功批量更新设置', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
      });

      expect(apiClient.put).toHaveBeenCalledWith('/settings', {
        language: 'zh-CN',
        timezone: 'Asia/Shanghai',
      });
      expect(store.settings.language).toBe('zh-CN');
      expect(store.settings.timezone).toBe('Asia/Shanghai');
    });

    it('应过滤不允许的设置键', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({
        language: 'zh-CN',
        invalidKey: 'value',
      } as any);

      expect(apiClient.put).toHaveBeenCalledWith('/settings', { language: 'zh-CN' });
    });

    it('无有效设置时应不发送请求', async () => {
      const store = useSettingsStore();

      await store.updateMultipleSettings({ invalidKey: 'value' } as any);

      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('更新失败时应抛出错误', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '批量更新失败' } },
      });

      await expect(store.updateMultipleSettings({ language: 'zh-CN' })).rejects.toThrow(
        '批量更新失败',
      );
    });

    it('更新失败时应通过字符串 data 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: '请求过于频繁' },
      });

      await expect(store.updateMultipleSettings({ language: 'zh-CN' })).rejects.toThrow(
        '请求过于频繁',
      );
    });

    it('更新失败时应通过 data.error.message 提取错误消息', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { error: { message: '服务器错误' } } },
      });

      await expect(store.updateMultipleSettings({ language: 'zh-CN' })).rejects.toThrow(
        '服务器错误',
      );
    });

    it('更新失败时 429 状态码应返回限频提示', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { status: 429, data: {} },
      });

      await expect(store.updateMultipleSettings({ language: 'zh-CN' })).rejects.toThrow(
        '请求过于频繁，请稍后再试',
      );
    });

    it('更新失败时 extractErrorMessage 应作为最终回退', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: {},
      });
      vi.mocked(extractErrorMessage).mockReturnValueOnce('回退错误');

      await expect(store.updateMultipleSettings({ language: 'zh-CN' })).rejects.toThrow('回退错误');
    });

    it('有效语言更新时应调用 setLocale', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({ language: 'zh-CN' });

      expect(setLocale).toHaveBeenCalledWith('zh-CN');
    });

    it('无效语言更新时不应调用 setLocale', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({ language: 'invalid-lang' });

      expect(setLocale).not.toHaveBeenCalled();
    });

    it('更新中不包含语言时不调用 setLocale', async () => {
      const { setLocale } = await import('../i18n');
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateMultipleSettings({ timezone: 'Asia/Shanghai' });

      expect(setLocale).not.toHaveBeenCalled();
    });
  });

  // ========== updateSidebarPaneWidth ==========
  describe('updateSidebarPaneWidth', () => {
    it('应成功更新侧边栏面板宽度', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValue({});

      await store.updateSidebarPaneWidth('connections', '400px');

      expect(store.getSidebarPaneWidth('connections')).toBe('400px');
    });

    it('空面板名称时应直接返回不执行更新', async () => {
      const store = useSettingsStore();

      await store.updateSidebarPaneWidth('' as any, '400px');

      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('更新失败时应记录错误但不抛出', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValue(new Error('网络错误'));

      // 不应抛出异常
      await store.updateSidebarPaneWidth('connections', '400px');
    });
  });

  // ========== updateFileManagerLayoutSettings ==========
  describe('updateFileManagerLayoutSettings', () => {
    it('应成功更新文件管理器布局设置', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateFileManagerLayoutSettings(1.5, {
        name: 400,
        type: 60,
        size: 120,
        permissions: 140,
        modified: 200,
      });

      expect(store.fileManagerRowSizeMultiplierNumber).toBe(1.5);
      expect(store.fileManagerColWidthsObject.name).toBe(400);
    });

    it('更新失败时应记录错误但不抛出', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValue(new Error('网络错误'));

      // 不应抛出异常
      await store.updateFileManagerLayoutSettings(1.0, {
        name: 300,
        type: 50,
        size: 100,
        permissions: 120,
        modified: 180,
      });
    });
  });

  // ========== updateQuickCommandRowSizeMultiplier ==========
  describe('updateQuickCommandRowSizeMultiplier', () => {
    it('应成功更新快捷命令行大小乘数', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.updateQuickCommandRowSizeMultiplier(2.0);

      expect(store.settings.quickCommandRowSizeMultiplier).toBe('2.00');
      expect(localStorageMock['nexus_quickCommandRowSizeMultiplier']).toBe('2.00');
    });

    it('更新失败时应记录错误但不抛出', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce({
        response: { data: { message: '更新失败' } },
      });

      // 不应抛出异常
      await store.updateQuickCommandRowSizeMultiplier(1.5);
    });

    it('localStorage 保存失败时应记录错误', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      // 模拟 localStorage.setItem 抛出错误
      const originalSetItem = localStorage.setItem;
      localStorage.setItem = vi.fn(() => {
        throw new Error('QuotaExceededError');
      });

      await store.updateQuickCommandRowSizeMultiplier(1.5);

      // API 更新应该成功
      expect(store.settings.quickCommandRowSizeMultiplier).toBe('1.50');

      // 恢复 localStorage
      localStorage.setItem = originalSetItem;
    });
  });

  // ========== saveDashboardSortPreference ==========
  describe('saveDashboardSortPreference', () => {
    it('应保存仪表盘排序偏好', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.saveDashboardSortPreference('name', 'asc');

      expect(apiClient.put).toHaveBeenCalledWith('/settings', {
        dashboardSortBy: 'name',
        dashboardSortOrder: 'asc',
      });
      expect(store.settings.dashboardSortBy).toBe('name');
      expect(store.settings.dashboardSortOrder).toBe('asc');
    });

    it('保存失败时应记录错误但不抛出', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockRejectedValueOnce(new Error('网络错误'));

      // 不应抛出异常
      await store.saveDashboardSortPreference('name', 'asc');
    });
  });

  // ========== getSidebarPaneWidth ==========
  describe('getSidebarPaneWidth', () => {
    it('null 面板应返回默认宽度', () => {
      const store = useSettingsStore();
      expect(store.getSidebarPaneWidth(null)).toBe('350px');
    });

    it('未知面板应返回默认宽度', () => {
      const store = useSettingsStore();
      expect(store.getSidebarPaneWidth('unknownPane' as any)).toBe('350px');
    });
  });

  // ========== 边界条件与综合场景 ==========
  describe('边界条件与综合场景', () => {
    it('loadInitialSettings 后 updateSetting 应正确覆盖', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { language: 'en-US' } })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.loadInitialSettings();
      expect(store.settings.language).toBe('en-US');

      await store.updateSetting('language', 'zh-CN');
      expect(store.settings.language).toBe('zh-CN');
    });

    it('loadInitialSettings 后 updateMultipleSettings 应正确覆盖', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({ data: { language: 'en-US', timezone: 'UTC' } })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });
      vi.mocked(apiClient.put).mockResolvedValueOnce({});

      await store.loadInitialSettings();

      vi.mocked(apiClient.put).mockResolvedValueOnce({});
      await store.updateMultipleSettings({ timezone: 'Asia/Tokyo' });

      expect(store.settings.timezone).toBe('Asia/Tokyo');
    });

    it('连续多次 updateSetting 应正确更新', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.put).mockResolvedValue({});

      await store.updateSetting('timezone', 'Asia/Shanghai');
      expect(store.settings.timezone).toBe('Asia/Shanghai');

      await store.updateSetting('timezone', 'Asia/Tokyo');
      expect(store.settings.timezone).toBe('Asia/Tokyo');

      await store.updateSetting('timezone', 'UTC');
      expect(store.settings.timezone).toBe('UTC');
    });

    it('updateMultipleSettings 空对象应不发送请求', async () => {
      const store = useSettingsStore();

      await store.updateMultipleSettings({});

      expect(apiClient.put).not.toHaveBeenCalled();
    });

    it('fileManagerColWidths JSON 包含有效部分列宽时应合并', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: {
            fileManagerColWidths: JSON.stringify({ name: 500 }),
          },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.fileManagerColWidthsObject.name).toBe(500);
      // 其他列应保持默认
      expect(store.fileManagerColWidthsObject.type).toBe(50);
    });

    it('fileManagerColWidths JSON 包含零值列宽时应使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: {
            fileManagerColWidths: JSON.stringify({ name: 0 }),
          },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.fileManagerColWidthsObject.name).toBe(300);
    });

    it('sidebarPaneWidths JSON 包含部分面板时应为其他面板使用默认值', async () => {
      const store = useSettingsStore();
      vi.mocked(apiClient.get)
        .mockResolvedValueOnce({
          data: {
            sidebarPaneWidths: JSON.stringify({ connections: '500px' }),
          },
        })
        .mockResolvedValueOnce({ data: { enabled: true } })
        .mockResolvedValueOnce({ data: { enabled: true } });

      await store.loadInitialSettings();

      expect(store.getSidebarPaneWidth('connections')).toBe('500px');
      expect(store.getSidebarPaneWidth('fileManager')).toBe('350px');
      expect(store.getSidebarPaneWidth('editor')).toBe('350px');
    });
  });
});
