/* eslint-disable @typescript-eslint/no-non-null-assertion */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';
import { ref } from 'vue';

// Mock 依赖
vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (params) return `${key}:${JSON.stringify(params)}`;
      return key;
    },
  }),
}));

vi.mock('vue-router', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
  }),
}));

vi.mock('./connections.store', () => ({
  useConnectionsStore: () => ({
    connections: [
      { id: 1, name: 'Test SSH', host: '192.168.1.1', port: 22, type: 'SSH' },
      { id: 2, name: 'Test RDP', host: '192.168.1.2', port: 3389, type: 'RDP' },
      { id: 3, name: 'Test VNC', host: '192.168.1.3', port: 5900, type: 'VNC' },
    ],
  }),
}));

// Mock session state — 使用模块级 ref 让测试可以操纵共享状态
const mockSessions = ref(new Map());
const mockActiveSessionId = ref<string | null>(null);
const mockIsRdpModalOpen = ref(false);
const mockRdpConnectionInfo = ref(null);
const mockIsVncModalOpen = ref(false);
const mockVncConnectionInfo = ref(null);
const mockSuspendedSshSessions = ref([]);
const mockIsLoadingSuspendedSessions = ref(false);

vi.mock('./session/state', () => ({
  sessions: mockSessions,
  activeSessionId: mockActiveSessionId,
  isRdpModalOpen: mockIsRdpModalOpen,
  rdpConnectionInfo: mockRdpConnectionInfo,
  isVncModalOpen: mockIsVncModalOpen,
  vncConnectionInfo: mockVncConnectionInfo,
  suspendedSshSessions: mockSuspendedSshSessions,
  isLoadingSuspendedSessions: mockIsLoadingSuspendedSessions,
}));

const mockSessionTabs = ref<Array<{ sessionId: string; connectionName: string }>>([]);
const mockSessionTabsWithStatus = ref<
  Array<{ sessionId: string; connectionName: string; status: string; isMarkedForSuspend: boolean }>
>([]);
const mockActiveSession = ref<{ sessionId: string; connectionName: string } | null>(null);

vi.mock('./session/getters', () => ({
  sessionTabs: mockSessionTabs,
  sessionTabsWithStatus: mockSessionTabsWithStatus,
  activeSession: mockActiveSession,
}));

vi.mock('./session/actions/sessionActions', () => ({
  openNewSession: vi.fn(),
  activateSession: vi.fn(),
  closeSession: vi.fn(),
  handleConnectRequest: vi.fn(),
  handleOpenNewSession: vi.fn(),
  cleanupAllSessions: vi.fn(),
}));

vi.mock('./session/actions/editorActions', () => ({
  openFileInSession: vi.fn(),
  closeEditorTabInSession: vi.fn(),
  setActiveEditorTabInSession: vi.fn(),
  updateFileContentInSession: vi.fn(),
  saveFileInSession: vi.fn(),
  reloadTabInSession: vi.fn(),
  changeEncodingInSession: vi.fn(),
  closeOtherTabsInSession: vi.fn(),
  closeTabsToTheRightInSession: vi.fn(),
  closeTabsToTheLeftInSession: vi.fn(),
  updateTabScrollPositionInSession: vi.fn(),
}));

vi.mock('./session/actions/sftpManagerActions', () => ({
  getOrCreateSftpManager: vi.fn(),
  removeSftpManager: vi.fn(),
}));

vi.mock('./session/actions/modalActions', () => ({
  openRdpModal: vi.fn(),
  closeRdpModal: vi.fn(),
  openVncModal: vi.fn(),
  closeVncModal: vi.fn(),
}));

vi.mock('./session/actions/commandInputActions', () => ({
  updateSessionCommandInput: vi.fn(),
}));

vi.mock('./session/actions/sshSuspendActions', () => ({
  requestStartSshSuspend: vi.fn(),
  requestUnmarkSshSuspend: vi.fn(),
  fetchSuspendedSshSessions: vi.fn(),
  resumeSshSession: vi.fn(),
  terminateAndRemoveSshSession: vi.fn(),
  removeSshSessionEntry: vi.fn(),
  editSshSessionName: vi.fn(),
  exportSshSessionLog: vi.fn(),
  registerSshSuspendHandlers: vi.fn(),
}));

// 辅助：创建模拟连接对象
const createMockConnection = (
  overrides: Partial<{
    id: number;
    name: string;
    type: 'SSH' | 'RDP' | 'VNC';
    host: string;
    port: number;
    username: string;
    auth_method: 'password' | 'key';
  }> = {},
) => ({
  id: overrides.id ?? 1,
  name: overrides.name ?? 'Test Connection',
  type: overrides.type ?? ('SSH' as const),
  host: overrides.host ?? '192.168.1.1',
  port: overrides.port ?? 22,
  username: overrides.username ?? 'root',
  auth_method: overrides.auth_method ?? ('password' as const),
  created_at: Date.now(),
  updated_at: Date.now(),
  last_connected_at: null,
});

describe('session.store', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
    mockSessions.value = new Map();
    mockActiveSessionId.value = null;
    mockIsRdpModalOpen.value = false;
    mockRdpConnectionInfo.value = null;
    mockIsVncModalOpen.value = false;
    mockVncConnectionInfo.value = null;
    mockSuspendedSshSessions.value = [];
    mockIsLoadingSuspendedSessions.value = false;
    mockSessionTabs.value = [];
    mockSessionTabsWithStatus.value = [];
    mockActiveSession.value = null;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('初始状态', () => {
    it('应该正确导出 state', async () => {
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(store.sessions).toBeDefined();
      expect(store.activeSessionId).toBeNull();
      expect(store.isRdpModalOpen).toBe(false);
      expect(store.rdpConnectionInfo).toBeNull();
      expect(store.isVncModalOpen).toBe(false);
      expect(store.vncConnectionInfo).toBeNull();
      expect(store.suspendedSshSessions).toEqual([]);
      expect(store.isLoadingSuspendedSessions).toBe(false);
    });
  });

  describe('Getters', () => {
    it('应该正确导出 getters 初始值', async () => {
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(Array.isArray(store.sessionTabs)).toBe(true);
      expect(Array.isArray(store.sessionTabsWithStatus)).toBe(true);
      expect(store.activeSession).toBeNull();
    });

    it('sessionTabs 应该返回预设的标签列表', async () => {
      mockSessionTabs.value = [
        { sessionId: 's1', connectionName: '服务器 A' },
        { sessionId: 's2', connectionName: '服务器 B' },
      ];

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(store.sessionTabs).toHaveLength(2);
      expect(store.sessionTabs[0].sessionId).toBe('s1');
      expect(store.sessionTabs[1].sessionId).toBe('s2');
    });

    it('sessionTabsWithStatus 应该返回带状态的标签信息', async () => {
      mockSessionTabsWithStatus.value = [
        {
          sessionId: 's1',
          connectionName: '服务器 A',
          status: 'connected',
          isMarkedForSuspend: false,
        },
        {
          sessionId: 's2',
          connectionName: '服务器 B',
          status: 'disconnected',
          isMarkedForSuspend: true,
        },
      ];

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(store.sessionTabsWithStatus).toHaveLength(2);
      expect(store.sessionTabsWithStatus[0].status).toBe('connected');
      expect(store.sessionTabsWithStatus[0].isMarkedForSuspend).toBe(false);
      expect(store.sessionTabsWithStatus[1].status).toBe('disconnected');
      expect(store.sessionTabsWithStatus[1].isMarkedForSuspend).toBe(true);
    });

    it('activeSession 应该返回当前活动会话', async () => {
      mockActiveSession.value = {
        sessionId: 'session-1',
        connectionName: '测试服务器',
      };

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(store.activeSession).toBeDefined();
      expect(store.activeSession!.sessionId).toBe('session-1');
    });

    it('activeSession 在无活动会话时应返回 null', async () => {
      mockActiveSession.value = null;

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(store.activeSession).toBeNull();
    });
  });

  describe('Session Actions', () => {
    it('openNewSession 应该调用 sessionActions.openNewSession 并传入正确的依赖', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.openNewSession('1');

      expect(sessionActions.openNewSession).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(sessionActions.openNewSession).mock.calls[0];
      expect(callArgs[0]).toBe('1');
      expect(callArgs[1]).toHaveProperty('connectionsStore');
      expect(callArgs[1]).toHaveProperty('t');
      expect(typeof callArgs[1].t).toBe('function');
    });

    it('openNewSession 接受字符串 ID 参数', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.openNewSession('42');

      expect(sessionActions.openNewSession).toHaveBeenCalledWith('42', expect.anything());
    });

    it('activateSession 应该调用 sessionActions.activateSession', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.activateSession('session-123');

      expect(sessionActions.activateSession).toHaveBeenCalledWith('session-123');
    });

    it('closeSession 应该调用 sessionActions.closeSession', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.closeSession('session-123');

      expect(sessionActions.closeSession).toHaveBeenCalledWith('session-123');
    });

    it('handleConnectRequest 应该调用 sessionActions.handleConnectRequest 并传入完整依赖', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();
      const conn = createMockConnection();

      store.handleConnectRequest(conn);

      expect(sessionActions.handleConnectRequest).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(sessionActions.handleConnectRequest).mock.calls[0];
      expect(callArgs[0]).toEqual(conn);
      expect(callArgs[1]).toHaveProperty('connectionsStore');
      expect(callArgs[1]).toHaveProperty('router');
      expect(callArgs[1]).toHaveProperty('openRdpModalAction');
      expect(callArgs[1]).toHaveProperty('openVncModalAction');
      expect(callArgs[1]).toHaveProperty('t');
    });

    it('handleOpenNewSession 应该调用 sessionActions.handleOpenNewSession', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.handleOpenNewSession('1');

      expect(sessionActions.handleOpenNewSession).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(sessionActions.handleOpenNewSession).mock.calls[0];
      expect(callArgs[0]).toBe('1');
      expect(callArgs[1]).toHaveProperty('connectionsStore');
      expect(callArgs[1]).toHaveProperty('t');
    });

    it('cleanupAllSessions 应该调用 sessionActions.cleanupAllSessions', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.cleanupAllSessions();

      expect(sessionActions.cleanupAllSessions).toHaveBeenCalledTimes(1);
    });
  });

  describe('Modal Actions', () => {
    it('openRdpModal 应该调用 modalActions.openRdpModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();
      const conn = createMockConnection({ type: 'RDP', port: 3389 });

      store.openRdpModal(conn);

      expect(modalActions.openRdpModal).toHaveBeenCalledWith(conn);
    });

    it('closeRdpModal 应该调用 modalActions.closeRdpModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.closeRdpModal();

      expect(modalActions.closeRdpModal).toHaveBeenCalledTimes(1);
    });

    it('openVncModal 应该调用 modalActions.openVncModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();
      const conn = createMockConnection({ type: 'VNC', port: 5900 });

      store.openVncModal(conn);

      expect(modalActions.openVncModal).toHaveBeenCalledWith(conn);
    });

    it('closeVncModal 应该调用 modalActions.closeVncModal', async () => {
      const modalActions = await import('./session/actions/modalActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.closeVncModal();

      expect(modalActions.closeVncModal).toHaveBeenCalledTimes(1);
    });
  });

  describe('Editor Actions', () => {
    const mockFileInfo = {
      fullPath: '/home/user/test.ts',
      name: 'test.ts',
      isDirectory: false,
      size: 1024,
      modified: Date.now(),
      permissions: 'rw-r--r--',
    };

    it('openFileInSession 应该调用 editorActions.openFileInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.openFileInSession('session-1', mockFileInfo as never);

      expect(editorActions.openFileInSession).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(editorActions.openFileInSession).mock.calls[0];
      expect(callArgs[0]).toBe('session-1');
      expect(callArgs[1]).toBe(mockFileInfo);
      expect(callArgs[2]).toHaveProperty('getOrCreateSftpManager');
      expect(callArgs[2]).toHaveProperty('t');
    });

    it('closeEditorTabInSession 应该调用 editorActions.closeEditorTabInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      vi.mocked(editorActions.closeEditorTabInSession).mockResolvedValue(true);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.closeEditorTabInSession('session-1', 'tab-1');

      expect(editorActions.closeEditorTabInSession).toHaveBeenCalledWith('session-1', 'tab-1');
    });

    it('setActiveEditorTabInSession 应该调用 editorActions.setActiveEditorTabInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.setActiveEditorTabInSession('session-1', 'tab-1');

      expect(editorActions.setActiveEditorTabInSession).toHaveBeenCalledWith('session-1', 'tab-1');
    });

    it('updateFileContentInSession 应该调用 editorActions.updateFileContentInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.updateFileContentInSession('session-1', 'tab-1', 'new content');

      expect(editorActions.updateFileContentInSession).toHaveBeenCalledWith(
        'session-1',
        'tab-1',
        'new content',
      );
    });

    it('saveFileInSession 应该调用 editorActions.saveFileInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      vi.mocked(editorActions.saveFileInSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.saveFileInSession('session-1', 'tab-1');

      expect(editorActions.saveFileInSession).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(editorActions.saveFileInSession).mock.calls[0];
      expect(callArgs[0]).toBe('session-1');
      expect(callArgs[1]).toBe('tab-1');
      expect(callArgs[2]).toHaveProperty('getOrCreateSftpManager');
      expect(callArgs[2]).toHaveProperty('t');
    });

    it('reloadTabInSession 应该调用 editorActions.reloadTabInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      vi.mocked(editorActions.reloadTabInSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.reloadTabInSession('session-1', 'tab-1');

      expect(editorActions.reloadTabInSession).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(editorActions.reloadTabInSession).mock.calls[0];
      expect(callArgs[0]).toBe('session-1');
      expect(callArgs[1]).toBe('tab-1');
      expect(callArgs[2]).toHaveProperty('getOrCreateSftpManager');
      expect(callArgs[2]).toHaveProperty('t');
    });

    it('changeEncodingInSession 应该调用 editorActions.changeEncodingInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.changeEncodingInSession('session-1', 'tab-1', 'gbk');

      expect(editorActions.changeEncodingInSession).toHaveBeenCalledWith(
        'session-1',
        'tab-1',
        'gbk',
      );
    });

    it('closeOtherTabsInSession 应该调用 editorActions.closeOtherTabsInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      vi.mocked(editorActions.closeOtherTabsInSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.closeOtherTabsInSession('session-1', 'tab-1');

      expect(editorActions.closeOtherTabsInSession).toHaveBeenCalledWith('session-1', 'tab-1');
    });

    it('closeTabsToTheRightInSession 应该调用 editorActions.closeTabsToTheRightInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      vi.mocked(editorActions.closeTabsToTheRightInSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.closeTabsToTheRightInSession('session-1', 'tab-2');

      expect(editorActions.closeTabsToTheRightInSession).toHaveBeenCalledWith('session-1', 'tab-2');
    });

    it('closeTabsToTheLeftInSession 应该调用 editorActions.closeTabsToTheLeftInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      vi.mocked(editorActions.closeTabsToTheLeftInSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.closeTabsToTheLeftInSession('session-1', 'tab-2');

      expect(editorActions.closeTabsToTheLeftInSession).toHaveBeenCalledWith('session-1', 'tab-2');
    });

    it('updateTabScrollPositionInSession 应该调用 editorActions.updateTabScrollPositionInSession', async () => {
      const editorActions = await import('./session/actions/editorActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.updateTabScrollPositionInSession('session-1', 'tab-1', 100, 50);

      expect(editorActions.updateTabScrollPositionInSession).toHaveBeenCalledWith(
        'session-1',
        'tab-1',
        100,
        50,
      );
    });
  });

  describe('SFTP Manager Actions', () => {
    it('getOrCreateSftpManager 应该调用 sftpManagerActions.getOrCreateSftpManager 并传入完整参数', async () => {
      const sftpManagerActions = await import('./session/actions/sftpManagerActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.getOrCreateSftpManager('session-123', 'instance-1', '/home');

      expect(sftpManagerActions.getOrCreateSftpManager).toHaveBeenCalledTimes(1);
      const callArgs = vi.mocked(sftpManagerActions.getOrCreateSftpManager).mock.calls[0];
      expect(callArgs[0]).toBe('session-123');
      expect(callArgs[1]).toBe('instance-1');
      expect(callArgs[2]).toHaveProperty('t');
      expect(callArgs[3]).toBe('/home');
    });

    it('getOrCreateSftpManager 不指定初始路径时应传入 undefined', async () => {
      const sftpManagerActions = await import('./session/actions/sftpManagerActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.getOrCreateSftpManager('session-123', 'instance-1');

      const callArgs = vi.mocked(sftpManagerActions.getOrCreateSftpManager).mock.calls[0];
      expect(callArgs[3]).toBeUndefined();
    });

    it('removeSftpManager 应该调用 sftpManagerActions.removeSftpManager', async () => {
      const sftpManagerActions = await import('./session/actions/sftpManagerActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.removeSftpManager('session-123', 'instance-1');

      expect(sftpManagerActions.removeSftpManager).toHaveBeenCalledWith(
        'session-123',
        'instance-1',
      );
    });
  });

  describe('Command Input Actions', () => {
    it('updateSessionCommandInput 应该调用 commandInputActions.updateSessionCommandInput', async () => {
      const commandInputActions = await import('./session/actions/commandInputActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.updateSessionCommandInput('session-123', 'ls -la');

      expect(commandInputActions.updateSessionCommandInput).toHaveBeenCalledWith(
        'session-123',
        'ls -la',
      );
    });

    it('updateSessionCommandInput 支持空字符串参数', async () => {
      const commandInputActions = await import('./session/actions/commandInputActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.updateSessionCommandInput('session-123', '');

      expect(commandInputActions.updateSessionCommandInput).toHaveBeenCalledWith('session-123', '');
    });
  });

  describe('SSH Suspend Actions', () => {
    it('应该导出所有 SSH 挂起相关 actions 为函数', async () => {
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(typeof store.requestStartSshSuspend).toBe('function');
      expect(typeof store.requestUnmarkSshSuspend).toBe('function');
      expect(typeof store.fetchSuspendedSshSessions).toBe('function');
      expect(typeof store.resumeSshSession).toBe('function');
      expect(typeof store.terminateAndRemoveSshSession).toBe('function');
      expect(typeof store.removeSshSessionEntry).toBe('function');
      expect(typeof store.editSshSessionName).toBe('function');
      expect(typeof store.exportSshSessionLog).toBe('function');
    });

    it('requestStartSshSuspend 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.requestStartSshSuspend('session-1');

      expect(sshSuspendActions.requestStartSshSuspend).toHaveBeenCalledWith('session-1');
    });

    it('requestUnmarkSshSuspend 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.requestUnmarkSshSuspend('session-1');

      expect(sshSuspendActions.requestUnmarkSshSuspend).toHaveBeenCalledWith('session-1');
    });

    it('fetchSuspendedSshSessions 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      vi.mocked(sshSuspendActions.fetchSuspendedSshSessions).mockResolvedValue({ ok: true });
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.fetchSuspendedSshSessions();

      expect(sshSuspendActions.fetchSuspendedSshSessions).toHaveBeenCalledTimes(1);
    });

    it('resumeSshSession 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      vi.mocked(sshSuspendActions.resumeSshSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.resumeSshSession('suspend-1');

      expect(sshSuspendActions.resumeSshSession).toHaveBeenCalledWith('suspend-1');
    });

    it('terminateAndRemoveSshSession 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      vi.mocked(sshSuspendActions.terminateAndRemoveSshSession).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.terminateAndRemoveSshSession('suspend-1');

      expect(sshSuspendActions.terminateAndRemoveSshSession).toHaveBeenCalledWith('suspend-1');
    });

    it('removeSshSessionEntry 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      vi.mocked(sshSuspendActions.removeSshSessionEntry).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.removeSshSessionEntry('suspend-1');

      expect(sshSuspendActions.removeSshSessionEntry).toHaveBeenCalledWith('suspend-1');
    });

    it('editSshSessionName 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      vi.mocked(sshSuspendActions.editSshSessionName).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.editSshSessionName('suspend-1', '新名称');

      expect(sshSuspendActions.editSshSessionName).toHaveBeenCalledWith('suspend-1', '新名称');
    });

    it('exportSshSessionLog 应该调用底层 sshSuspendActions', async () => {
      const sshSuspendActions = await import('./session/actions/sshSuspendActions');
      vi.mocked(sshSuspendActions.exportSshSessionLog).mockResolvedValue(undefined);
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      await store.exportSshSessionLog('suspend-1');

      expect(sshSuspendActions.exportSshSessionLog).toHaveBeenCalledWith('suspend-1');
    });
  });

  describe('边界条件', () => {
    it('在空 sessions map 下操作不应抛出异常', async () => {
      mockSessions.value = new Map();

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(() => store.activateSession('nonexistent')).not.toThrow();
      expect(() => store.closeSession('nonexistent')).not.toThrow();
    });

    it('在无活动会话时调用 activateSession 不应抛出异常', async () => {
      mockActiveSessionId.value = null;
      mockSessions.value = new Map();

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(() => store.activateSession('session-xyz')).not.toThrow();
    });

    it('cleanupAllSessions 后 sessions 应该清空', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      vi.mocked(sessionActions.cleanupAllSessions).mockImplementation(() => {
        mockSessions.value = new Map();
        mockActiveSessionId.value = null;
      });

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.cleanupAllSessions();

      expect(mockSessions.value.size).toBe(0);
      expect(mockActiveSessionId.value).toBeNull();
    });

    it('多个 store 实例应共享同一份 state', async () => {
      const { useSessionStore } = await import('./session.store');
      const store1 = useSessionStore();
      const store2 = useSessionStore();

      mockActiveSessionId.value = 'session-shared';

      expect(store1.activeSessionId).toBe('session-shared');
      expect(store2.activeSessionId).toBe('session-shared');
    });

    it('handleConnectRequest 传入不同类型的连接时应正确路由', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      const sshConn = createMockConnection({ type: 'SSH' });
      store.handleConnectRequest(sshConn);
      expect(sessionActions.handleConnectRequest).toHaveBeenCalledWith(sshConn, expect.anything());

      vi.mocked(sessionActions.handleConnectRequest).mockClear();

      const rdpConn = createMockConnection({ type: 'RDP', port: 3389 });
      store.handleConnectRequest(rdpConn);
      expect(sessionActions.handleConnectRequest).toHaveBeenCalledWith(rdpConn, expect.anything());
    });

    it('sessionTabsWithStatus 在有自定义排序时应按指定顺序返回', async () => {
      mockSessionTabsWithStatus.value = [
        { sessionId: 's2', connectionName: 'B', status: 'connected', isMarkedForSuspend: false },
        { sessionId: 's1', connectionName: 'A', status: 'disconnected', isMarkedForSuspend: false },
      ];

      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      expect(store.sessionTabsWithStatus[0].sessionId).toBe('s2');
      expect(store.sessionTabsWithStatus[1].sessionId).toBe('s1');
    });
  });

  describe('Action 依赖注入', () => {
    it('handleConnectRequest 传入的 openRdpModalAction 应该是包装后的函数', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.handleConnectRequest(createMockConnection());

      const callArgs = vi.mocked(sessionActions.handleConnectRequest).mock.calls[0];
      const deps = callArgs[1];
      expect(typeof deps.openRdpModalAction).toBe('function');
      expect(typeof deps.openVncModalAction).toBe('function');
    });

    it('openNewSession 传入的 t 函数应该能返回翻译后的字符串', async () => {
      const sessionActions = await import('./session/actions/sessionActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.openNewSession('1');

      const callArgs = vi.mocked(sessionActions.openNewSession).mock.calls[0];
      const t = callArgs[1].t;
      expect(t('test.key')).toBe('test.key');
      expect(t('test.key', { name: 'test' })).toContain('test.key');
    });

    it('getOrCreateSftpManager 传入的 t 函数应该可调用', async () => {
      const sftpManagerActions = await import('./session/actions/sftpManagerActions');
      const { useSessionStore } = await import('./session.store');
      const store = useSessionStore();

      store.getOrCreateSftpManager('s1', 'i1');

      const callArgs = vi.mocked(sftpManagerActions.getOrCreateSftpManager).mock.calls[0];
      expect(typeof callArgs[2].t).toBe('function');
    });
  });
});
