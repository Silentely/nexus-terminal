/**
 * SSH 挂起 Actions 单元测试
 * 测试 HTTP API 调用和 WebSocket 消息处理器
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ref } from 'vue';

// 使用 vi.hoisted 确保变量在 vi.mock 之前可用
// 注意：vi.hoisted 在 ES imports 之前执行，不能使用 ref
const {
  mockApiGet,
  mockApiDelete,
  mockApiPut,
  mockAddNotification,
  mockSendMessage,
  mockOnMessage,
  mockIsConnectedRaw,
  sessionsMap,
  sessionsRef,
  suspendedSshSessionsRef,
  isLoadingRef,
  mockTerminalWrite,
} = vi.hoisted(() => {
  const _sessionsMap = new Map() as Map<string, any>;
  return {
    mockApiGet: vi.fn(),
    mockApiDelete: vi.fn(),
    mockApiPut: vi.fn(),
    mockAddNotification: vi.fn(),
    mockSendMessage: vi.fn(),
    mockOnMessage: vi.fn(),
    mockIsConnectedRaw: { value: true },
    sessionsMap: _sessionsMap,
    sessionsRef: { value: _sessionsMap },
    suspendedSshSessionsRef: { value: [] as unknown[] },
    isLoadingRef: { value: false },
    mockTerminalWrite: vi.fn(),
  };
});

const mockTerminalInstance = ref({
  buffer: {
    active: {
      length: 3,
      getLine: (index: number) => ({
        translateToString: (_trim: boolean) => {
          const lines = ['line1', 'line2', ''];
          return lines[index] || '';
        },
      }),
    },
  },
  write: mockTerminalWrite,
});

vi.mock('@/utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockApiGet(...args),
    delete: (...args: unknown[]) => mockApiDelete(...args),
    put: (...args: unknown[]) => mockApiPut(...args),
  },
}));

vi.mock('@/utils/errorExtractor', () => ({
  extractErrorMessage: (error: unknown, fallback: string) =>
    error instanceof Error ? error.message : fallback,
}));

vi.mock('@/utils/log', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../i18n', () => ({
  default: {
    global: {
      t: (key: string, params?: Record<string, unknown>) => {
        if (params) return `${key}:${JSON.stringify(params)}`;
        return key;
      },
    },
  },
}));

vi.mock('../../uiNotifications.store', () => ({
  useUiNotificationsStore: () => ({
    addNotification: mockAddNotification,
  }),
}));

vi.mock('../../connections.store', () => ({
  useConnectionsStore: () => ({
    connections: [{ id: 1, name: 'Test Server', host: '192.168.1.1', port: 22 }],
  }),
}));

vi.mock('../state', () => ({
  sessions: sessionsRef,
  suspendedSshSessions: suspendedSshSessionsRef,
  isLoadingSuspendedSessions: isLoadingRef,
}));

vi.mock('../actions/sessionActions', () => ({
  openNewSession: vi.fn(),
  closeSession: vi.fn(),
  activateSession: vi.fn(),
}));

// 辅助函数：注册处理器并返回回调
async function getRegisteredHandlers() {
  const { registerSshSuspendHandlers } = await import('./sshSuspendActions');
  const mockWsManager = {
    onMessage: mockOnMessage,
    isConnected: mockIsConnectedRaw,
    isSftpReady: ref(true),
    sendMessage: mockSendMessage,
  };
  registerSshSuspendHandlers(mockWsManager as any);
  const handlers: Record<string, Function> = {};
  for (const call of mockOnMessage.mock.calls) {
    handlers[call[0]] = call[1];
  }
  return handlers;
}

describe('sshSuspendActions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // registerSshSuspendHandlers 内部会 fire-and-forget 调用 fetchSuspendedSshSessions
    // 返回当前引用值，避免替换 suspendedSshSessions.value 引用
    mockApiGet.mockImplementation((url: string) => {
      if (url === 'ssh-suspend/suspended-sessions') {
        return Promise.resolve({ data: suspendedSshSessionsRef.value });
      }
      return Promise.resolve({ data: null });
    });
    mockIsConnectedRaw.value = true;
    sessionsMap.clear();
    sessionsRef.value = sessionsMap; // 重置引用（handler 会执行 sessions.value = new Map(...)）
    suspendedSshSessionsRef.value = [];
    isLoadingRef.value = false;
    mockTerminalInstance.value = {
      buffer: {
        active: {
          length: 3,
          getLine: (index: number) => ({
            translateToString: (_trim: boolean) => {
              const lines = ['line1', 'line2', ''];
              return lines[index] || '';
            },
          }),
        },
      },
      write: mockTerminalWrite,
    };
  });

  afterEach(async () => {
    // registerSshSuspendHandlers 内部会 fire-and-forget 调用 fetchSuspendedSshSessions，
    // 产生一个 pending 的 Promise。必须在测试结束前让其 settle，
    // 否则在慢速 CI 上该 Promise 可能在测试环境 teardown 后才 resolve/reject，
    // 触发 "caught after test environment was torn down" 报错。
    await vi.waitFor(() => Promise.resolve(), { timeout: 500 }).catch(() => undefined);
  });

  describe('fetchSuspendedSshSessions', () => {
    it('应成功获取挂起会话列表', async () => {
      const mockSessions = [
        { suspendSessionId: 's1', connectionName: 'Server 1', connectionId: '1' },
      ];
      mockApiGet.mockResolvedValue({ data: mockSessions });

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      const result = await fetchSuspendedSshSessions({ showLoadingIndicator: false });

      expect(result.ok).toBe(true);
      expect(result.status).toBe(200);
      expect(mockApiGet).toHaveBeenCalledWith('ssh-suspend/suspended-sessions');
    });

    it('获取失败时应返回错误状态', async () => {
      mockApiGet.mockRejectedValue(new Error('Network error'));

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      const result = await fetchSuspendedSshSessions({
        showLoadingIndicator: false,
        notifyOnError: false,
      });

      expect(result.ok).toBe(false);
    });

    it('应支持显示加载指示器', async () => {
      mockApiGet.mockResolvedValue({ data: [] });

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      await fetchSuspendedSshSessions({ showLoadingIndicator: true });

      expect(mockApiGet).toHaveBeenCalled();
    });

    it('应支持禁用错误通知', async () => {
      mockApiGet.mockRejectedValue(new Error('fail'));

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      await fetchSuspendedSshSessions({ notifyOnError: false, showLoadingIndicator: false });

      expect(mockAddNotification).not.toHaveBeenCalled();
    });

    it('默认参数时应显示加载指示器并通知错误', async () => {
      mockApiGet.mockRejectedValue(new Error('default-err'));

      const { fetchSuspendedSshSessions } = await import('./sshSuspendActions');
      const result = await fetchSuspendedSshSessions();

      expect(result.ok).toBe(false);
      expect(mockAddNotification).toHaveBeenCalled();
    });
  });

  describe('requestStartSshSuspend', () => {
    it('会话不存在时应显示错误通知', async () => {
      const { requestStartSshSuspend } = await import('./sshSuspendActions');
      requestStartSshSuspend('non-existent-session');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('WS 未连接时应显示错误通知', async () => {
      mockIsConnectedRaw.value = false;
      sessionsMap.set('sess-1', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
      });

      const { requestStartSshSuspend } = await import('./sshSuspendActions');
      requestStartSshSuspend('sess-1');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('WS 已连接且有终端实例时应提取缓冲区并发送消息', async () => {
      sessionsMap.set('sess-1', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
        terminalManager: { terminalInstance: mockTerminalInstance },
      });

      const { requestStartSshSuspend } = await import('./sshSuspendActions');
      requestStartSshSuspend('sess-1');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SSH_MARK_FOR_SUSPEND',
          payload: expect.objectContaining({
            sessionId: 'sess-1',
            initialBuffer: 'line1\nline2',
          }),
        }),
      );
    });

    it('WS 已连接但无终端实例时应发送消息且 initialBuffer 为 undefined', async () => {
      sessionsMap.set('sess-2', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
        terminalManager: null,
      });

      const { requestStartSshSuspend } = await import('./sshSuspendActions');
      requestStartSshSuspend('sess-2');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SSH_MARK_FOR_SUSPEND',
          payload: expect.objectContaining({
            sessionId: 'sess-2',
            initialBuffer: undefined,
          }),
        }),
      );
    });

    it('终端缓冲区超过 1MB 时应截断最早的输出', async () => {
      // 模拟一个超大缓冲区：每行约 50KB，25 行 ≈ 1.25MB
      const largeLine = 'A'.repeat(50000);
      const lineCount = 25;
      mockTerminalInstance.value = {
        buffer: {
          active: {
            length: lineCount,
            getLine: (index: number) => ({
              translateToString: (_trim: boolean) => (index < lineCount ? largeLine : ''),
            }),
          },
        },
        write: mockTerminalWrite,
      };

      sessionsMap.set('sess-large', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
        terminalManager: { terminalInstance: mockTerminalInstance },
      });

      const { requestStartSshSuspend } = await import('./sshSuspendActions');
      requestStartSshSuspend('sess-large');

      const sentMessage = mockSendMessage.mock.calls[0][0] as {
        payload: { initialBuffer?: string };
      };
      const sentBuffer = sentMessage.payload.initialBuffer as string;
      expect(sentBuffer).toBeDefined();

      // 验证：缓冲区大小应小于 1MB
      expect(new TextEncoder().encode(sentBuffer).length).toBeLessThan(1048576);

      // 验证：应保留了最新内容（末尾的行）
      const sentLines = sentBuffer.split('\n');
      expect(sentLines.length).toBeGreaterThan(0);
      expect(sentLines.length).toBeLessThan(lineCount); // 应该被截断了

      // 验证：保留的行都是最新的（最后几行）
      // 最后一行应该是完整的大行
      expect(sentLines[sentLines.length - 1]).toBe(largeLine);
    });
  });

  describe('requestUnmarkSshSuspend', () => {
    it('会话不存在时应显示错误通知', async () => {
      const { requestUnmarkSshSuspend } = await import('./sshSuspendActions');
      requestUnmarkSshSuspend('non-existent-session');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('WS 未连接时应显示错误通知', async () => {
      mockIsConnectedRaw.value = false;
      sessionsMap.set('sess-1', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
        isMarkedForSuspend: true,
      });

      const { requestUnmarkSshSuspend } = await import('./sshSuspendActions');
      requestUnmarkSshSuspend('sess-1');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('会话未被标记为待挂起时应显示 info 通知', async () => {
      sessionsMap.set('sess-1', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
        isMarkedForSuspend: false,
      });

      const { requestUnmarkSshSuspend } = await import('./sshSuspendActions');
      requestUnmarkSshSuspend('sess-1');

      expect(mockSendMessage).not.toHaveBeenCalled();
      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    });

    it('WS 已连接且会话已标记时应发送取消标记消息', async () => {
      sessionsMap.set('sess-1', {
        wsManager: { isConnected: mockIsConnectedRaw, sendMessage: mockSendMessage },
        isMarkedForSuspend: true,
      });

      const { requestUnmarkSshSuspend } = await import('./sshSuspendActions');
      requestUnmarkSshSuspend('sess-1');

      expect(mockSendMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'SSH_UNMARK_FOR_SUSPEND',
          payload: { sessionId: 'sess-1' },
        }),
      );
    });
  });

  describe('terminateAndRemoveSshSession', () => {
    it('应成功终止并移除会话', async () => {
      mockApiDelete.mockResolvedValue({});

      const { terminateAndRemoveSshSession } = await import('./sshSuspendActions');
      await terminateAndRemoveSshSession('session-123');

      expect(mockApiDelete).toHaveBeenCalledWith('ssh-suspend/terminate/session-123');
    });

    it('终止失败时应显示错误通知', async () => {
      mockApiDelete.mockRejectedValue(new Error('Delete failed'));

      const { terminateAndRemoveSshSession } = await import('./sshSuspendActions');
      await terminateAndRemoveSshSession('session-123');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('成功且会话在本地列表中时应 splice 移除并显示通知', async () => {
      suspendedSshSessionsRef.value = [
        { suspendSessionId: 's1', connectionName: 'Server A', customSuspendName: null },
        { suspendSessionId: 's2', connectionName: 'Server B', customSuspendName: 'My Server' },
      ];
      mockApiDelete.mockResolvedValue({});

      const { terminateAndRemoveSshSession } = await import('./sshSuspendActions');
      await terminateAndRemoveSshSession('s1');

      expect(suspendedSshSessionsRef.value).toHaveLength(1);
      expect((suspendedSshSessionsRef.value[0] as any).suspendSessionId).toBe('s2');
      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    });

    it('成功但会话不在本地列表时不应显示通知', async () => {
      suspendedSshSessionsRef.value = [];
      mockApiDelete.mockResolvedValue({});

      const { terminateAndRemoveSshSession } = await import('./sshSuspendActions');
      await terminateAndRemoveSshSession('s-nonexistent');

      expect(mockAddNotification).not.toHaveBeenCalled();
    });
  });

  describe('removeSshSessionEntry', () => {
    it('应成功移除已断开的条目', async () => {
      mockApiDelete.mockResolvedValue({});

      const { removeSshSessionEntry } = await import('./sshSuspendActions');
      await removeSshSessionEntry('session-456');

      expect(mockApiDelete).toHaveBeenCalledWith('ssh-suspend/entry/session-456');
    });

    it('移除失败时应显示错误通知', async () => {
      mockApiDelete.mockRejectedValue(new Error('Remove failed'));

      const { removeSshSessionEntry } = await import('./sshSuspendActions');
      await removeSshSessionEntry('session-456');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('成功且会话在本地列表中时应 splice 移除并显示通知', async () => {
      suspendedSshSessionsRef.value = [
        { suspendSessionId: 'e1', connectionName: 'Conn1', customSuspendName: 'Custom' },
        { suspendSessionId: 'e2', connectionName: 'Conn2', customSuspendName: null },
      ];
      mockApiDelete.mockResolvedValue({});

      const { removeSshSessionEntry } = await import('./sshSuspendActions');
      await removeSshSessionEntry('e1');

      expect(suspendedSshSessionsRef.value).toHaveLength(1);
      expect((suspendedSshSessionsRef.value[0] as any).suspendSessionId).toBe('e2');
      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
    });

    it('成功但会话不在本地列表时不应显示通知', async () => {
      suspendedSshSessionsRef.value = [];
      mockApiDelete.mockResolvedValue({});

      const { removeSshSessionEntry } = await import('./sshSuspendActions');
      await removeSshSessionEntry('e-nonexistent');

      expect(mockAddNotification).not.toHaveBeenCalled();
    });
  });

  describe('editSshSessionName', () => {
    it('应成功编辑会话名称', async () => {
      suspendedSshSessionsRef.value = [{ suspendSessionId: 's1', customSuspendName: 'Old' }];
      mockApiPut.mockResolvedValue({ data: { customName: 'New Name' } });

      const { editSshSessionName } = await import('./sshSuspendActions');
      await editSshSessionName('s1', 'New Name');

      expect(mockApiPut).toHaveBeenCalledWith('ssh-suspend/name/s1', { customName: 'New Name' });
      expect((suspendedSshSessionsRef.value[0] as any).customSuspendName).toBe('New Name');
      expect(mockAddNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' }),
      );
    });

    it('编辑失败时应显示错误通知', async () => {
      mockApiPut.mockRejectedValue(new Error('Edit failed'));

      const { editSshSessionName } = await import('./sshSuspendActions');
      await editSshSessionName('session-789', 'Bad Name');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });

    it('会话在本地列表中未找到时应回退到 fetchSuspendedSshSessions', async () => {
      suspendedSshSessionsRef.value = [];
      mockApiPut.mockResolvedValue({ data: { customName: 'X' } });
      mockApiGet.mockResolvedValue({ data: [] });

      const { editSshSessionName } = await import('./sshSuspendActions');
      await editSshSessionName('s-missing', 'X');

      expect(mockApiGet).toHaveBeenCalledWith('ssh-suspend/suspended-sessions');
    });
  });

  describe('exportSshSessionLog', () => {
    it('应成功导出日志', async () => {
      const mockBlob = new Blob(['log data']);
      mockApiGet.mockResolvedValue({
        data: mockBlob,
        headers: { 'content-disposition': 'filename="test.log"' },
      });

      const mockClick = vi.fn();
      const mockLink = {
        href: '',
        setAttribute: vi.fn(),
        click: mockClick,
        parentNode: { removeChild: vi.fn() },
      };
      vi.spyOn(document, 'createElement').mockReturnValue(mockLink as unknown as HTMLElement);
      vi.spyOn(document.body, 'appendChild').mockImplementation(
        () => mockLink as unknown as HTMLElement,
      );

      const { exportSshSessionLog } = await import('./sshSuspendActions');
      await exportSshSessionLog('session-export');

      expect(mockApiGet).toHaveBeenCalledWith('ssh-suspend/log/session-export', {
        responseType: 'blob',
      });
      expect(mockClick).toHaveBeenCalled();
    });

    it('导出失败时应显示错误通知', async () => {
      mockApiGet.mockRejectedValue(new Error('Export failed'));

      const { exportSshSessionLog } = await import('./sshSuspendActions');
      await exportSshSessionLog('session-export');

      expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
    });
  });

  describe('registerSshSuspendHandlers', () => {
    it('应注册所有 SSH 挂起消息处理器', async () => {
      const mockWsManager = {
        onMessage: mockOnMessage,
        isConnected: mockIsConnectedRaw,
        isSftpReady: ref(true),
        sendMessage: mockSendMessage,
      };

      const { registerSshSuspendHandlers } = await import('./sshSuspendActions');
      registerSshSuspendHandlers(mockWsManager as any);

      expect(mockOnMessage).toHaveBeenCalledWith(
        'SSH_MARKED_FOR_SUSPEND_ACK',
        expect.any(Function),
      );
      expect(mockOnMessage).toHaveBeenCalledWith(
        'SSH_UNMARKED_FOR_SUSPEND_ACK',
        expect.any(Function),
      );
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_LIST_RESPONSE', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_RESUMED', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_OUTPUT_CACHED_CHUNK', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_TERMINATED', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith('SSH_SUSPEND_ENTRY_REMOVED', expect.any(Function));
      expect(mockOnMessage).toHaveBeenCalledWith(
        'SSH_SUSPEND_AUTO_TERMINATED',
        expect.any(Function),
      );
    });

    it('wsManager 为 undefined 时不应崩溃', async () => {
      const { registerSshSuspendHandlers } = await import('./sshSuspendActions');

      expect(() => registerSshSuspendHandlers(undefined as any)).not.toThrow();
    });

    it('注册后应立即调用 fetchSuspendedSshSessions', async () => {
      mockApiGet.mockResolvedValue({ data: [] });
      const mockWsManager = {
        onMessage: mockOnMessage,
        isConnected: mockIsConnectedRaw,
        isSftpReady: ref(true),
        sendMessage: mockSendMessage,
      };

      const { registerSshSuspendHandlers } = await import('./sshSuspendActions');
      registerSshSuspendHandlers(mockWsManager as any);

      expect(mockApiGet).toHaveBeenCalledWith('ssh-suspend/suspended-sessions');
    });
  });

  describe('WebSocket 消息处理器', () => {
    describe('handleSshMarkedForSuspendAck', () => {
      it('成功时应标记会话并显示成功通知', async () => {
        sessionsMap.set('sess-1', { isMarkedForSuspend: false });
        const handlers = await getRegisteredHandlers();

        handlers['SSH_MARKED_FOR_SUSPEND_ACK']({
          success: true,
          sessionId: 'sess-1',
        });

        expect(sessionsMap.get('sess-1').isMarkedForSuspend).toBe(true);
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        );
      });

      it('失败时应清除标记并显示错误通知', async () => {
        sessionsMap.set('sess-1', { isMarkedForSuspend: true });
        const handlers = await getRegisteredHandlers();

        handlers['SSH_MARKED_FOR_SUSPEND_ACK']({
          success: false,
          sessionId: 'sess-1',
          error: 'mark error',
        });

        expect(sessionsMap.get('sess-1').isMarkedForSuspend).toBe(false);
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });

      it('会话不存在时不应崩溃', async () => {
        const handlers = await getRegisteredHandlers();

        expect(() =>
          handlers['SSH_MARKED_FOR_SUSPEND_ACK']({
            success: true,
            sessionId: 'nonexistent',
          }),
        ).not.toThrow();
      });
    });

    describe('handleSshUnmarkedForSuspendAck', () => {
      it('成功时应清除标记并显示成功通知', async () => {
        sessionsMap.set('sess-1', { isMarkedForSuspend: true });
        const handlers = await getRegisteredHandlers();

        handlers['SSH_UNMARKED_FOR_SUSPEND_ACK']({
          success: true,
          sessionId: 'sess-1',
        });

        expect(sessionsMap.get('sess-1').isMarkedForSuspend).toBe(false);
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        );
      });

      it('失败时应显示错误通知', async () => {
        const handlers = await getRegisteredHandlers();

        handlers['SSH_UNMARKED_FOR_SUSPEND_ACK']({
          success: false,
          sessionId: 'sess-1',
          error: 'unmark error',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });

    describe('handleSshSuspendListResponse', () => {
      it('应更新挂起会话列表并清除加载状态', async () => {
        isLoadingRef.value = true;
        const handlers = await getRegisteredHandlers();
        const mockSessions = [{ suspendSessionId: 's1', connectionName: 'Server' }];

        handlers['SSH_SUSPEND_LIST_RESPONSE']({ suspendSessions: mockSessions });

        expect(suspendedSshSessionsRef.value).toEqual(mockSessions);
        expect(isLoadingRef.value).toBe(false);
      });
    });

    describe('handleSshSuspendResumed', () => {
      it('成功且找到会话时应标记恢复、激活并显示成功通知', async () => {
        suspendedSshSessionsRef.value = [
          { suspendSessionId: 's1', connectionName: 'Server', customSuspendName: null },
        ];
        sessionsMap.set('new-sess', {
          wsManager: {},
          isResuming: false,
        });
        const handlers = await getRegisteredHandlers();

        await handlers['SSH_SUSPEND_RESUMED']({
          success: true,
          suspendSessionId: 's1',
          newFrontendSessionId: 'new-sess',
        });

        expect(sessionsMap.get('new-sess').isResuming).toBe(true);
        expect(suspendedSshSessionsRef.value).toHaveLength(0);
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        );
      });

      it('成功但挂起列表中未找到时仍应移除并通知', async () => {
        suspendedSshSessionsRef.value = [];
        sessionsMap.set('new-sess', { wsManager: {}, isResuming: false });
        const handlers = await getRegisteredHandlers();

        await handlers['SSH_SUSPEND_RESUMED']({
          success: true,
          suspendSessionId: 's-missing',
          newFrontendSessionId: 'new-sess',
        });

        expect(suspendedSshSessionsRef.value).toHaveLength(0);
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'success' }),
        );
      });

      it('成功但新会话不存在时应显示错误通知', async () => {
        sessionsMap.clear();
        const handlers = await getRegisteredHandlers();

        await handlers['SSH_SUSPEND_RESUMED']({
          success: true,
          suspendSessionId: 's1',
          newFrontendSessionId: 'missing-sess',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });

      it('成功但新会话缺少 wsManager 时应显示错误通知', async () => {
        sessionsMap.set('new-sess', { wsManager: null, isResuming: false });
        const handlers = await getRegisteredHandlers();

        await handlers['SSH_SUSPEND_RESUMED']({
          success: true,
          suspendSessionId: 's1',
          newFrontendSessionId: 'new-sess',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });

      it('失败时应显示错误通知并关闭前端会话', async () => {
        sessionsMap.set('new-sess', { wsManager: {}, isResuming: false });
        const handlers = await getRegisteredHandlers();

        await handlers['SSH_SUSPEND_RESUMED']({
          success: false,
          suspendSessionId: 's1',
          newFrontendSessionId: 'new-sess',
          error: 'resume error',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });

      it('失败且前端会话不存在时不应崩溃', async () => {
        sessionsMap.clear();
        const handlers = await getRegisteredHandlers();

        await expect(
          handlers['SSH_SUSPEND_RESUMED']({
            success: false,
            suspendSessionId: 's1',
            newFrontendSessionId: 'no-sess',
            error: 'err',
          }),
        ).resolves.toBeUndefined();
      });
    });

    describe('handleSshOutputCachedChunk', () => {
      it('终端实例就绪时应直接写入数据', async () => {
        sessionsMap.set('new-sess', {
          terminalManager: { terminalInstance: mockTerminalInstance },
          isResuming: true,
        });
        const handlers = await getRegisteredHandlers();

        handlers['SSH_OUTPUT_CACHED_CHUNK']({
          frontendSessionId: 'new-sess',
          data: 'cached output',
          isLastChunk: false,
        });

        expect(mockTerminalWrite).toHaveBeenCalledWith('cached output');
      });

      it('终端实例未就绪时应暂存到 pendingOutput', async () => {
        const nullTerminal = ref(null);
        const session = {
          terminalManager: { terminalInstance: nullTerminal },
          isResuming: true,
        };
        sessionsMap.set('new-sess', session);
        const handlers = await getRegisteredHandlers();

        handlers['SSH_OUTPUT_CACHED_CHUNK']({
          frontendSessionId: 'new-sess',
          data: 'buffered data',
          isLastChunk: false,
        });

        expect((session as any).pendingOutput).toEqual(['buffered data']);
      });

      it('会话不存在时不应崩溃', async () => {
        const handlers = await getRegisteredHandlers();

        expect(() =>
          handlers['SSH_OUTPUT_CACHED_CHUNK']({
            frontendSessionId: 'nonexistent',
            data: 'data',
            isLastChunk: false,
          }),
        ).not.toThrow();
      });

      it('isLastChunk 为 true 时应记录日志', async () => {
        sessionsMap.set('new-sess', {
          terminalManager: { terminalInstance: mockTerminalInstance },
          isResuming: true,
        });
        const handlers = await getRegisteredHandlers();

        expect(() =>
          handlers['SSH_OUTPUT_CACHED_CHUNK']({
            frontendSessionId: 'new-sess',
            data: 'last chunk',
            isLastChunk: true,
          }),
        ).not.toThrow();
      });
    });

    describe('handleSshSuspendTerminated', () => {
      it('成功且找到会话时应 splice 移除并显示通知', async () => {
        suspendedSshSessionsRef.value = [
          { suspendSessionId: 's1', connectionName: 'Server', customSuspendName: 'MyServer' },
        ];
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_TERMINATED']({ success: true, suspendSessionId: 's1' });

        expect(suspendedSshSessionsRef.value).toHaveLength(0);
        expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
      });

      it('成功但会话不在列表时不应显示通知', async () => {
        suspendedSshSessionsRef.value = [];
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_TERMINATED']({ success: true, suspendSessionId: 's-missing' });

        expect(mockAddNotification).not.toHaveBeenCalled();
      });

      it('失败时应显示错误通知', async () => {
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_TERMINATED']({
          success: false,
          suspendSessionId: 's1',
          error: 'terminate error',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });

    describe('handleSshSuspendEntryRemoved', () => {
      it('成功且找到会话时应 splice 移除并显示通知', async () => {
        suspendedSshSessionsRef.value = [
          { suspendSessionId: 'e1', connectionName: 'Conn', customSuspendName: null },
        ];
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_ENTRY_REMOVED']({ success: true, suspendSessionId: 'e1' });

        expect(suspendedSshSessionsRef.value).toHaveLength(0);
        expect(mockAddNotification).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
      });

      it('成功但会话不在列表时不应显示通知', async () => {
        suspendedSshSessionsRef.value = [];
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_ENTRY_REMOVED']({ success: true, suspendSessionId: 'e-missing' });

        expect(mockAddNotification).not.toHaveBeenCalled();
      });

      it('失败时应显示错误通知', async () => {
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_ENTRY_REMOVED']({
          success: false,
          suspendSessionId: 'e1',
          error: 'remove error',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'error' }),
        );
      });
    });

    describe('handleSshSuspendAutoTerminated', () => {
      it('找到会话时应更新状态并显示警告通知', async () => {
        suspendedSshSessionsRef.value = [
          { suspendSessionId: 's1', connectionName: 'Server', customSuspendName: null },
        ];
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_AUTO_TERMINATED']({
          suspendSessionId: 's1',
          reason: 'timeout',
        });

        expect((suspendedSshSessionsRef.value[0] as any).backendSshStatus).toBe(
          'disconnected_by_backend',
        );
        expect((suspendedSshSessionsRef.value[0] as any).disconnectionTimestamp).toBeDefined();
        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'warning' }),
        );
      });

      it('找到会话且有自定义名称时应使用自定义名称', async () => {
        suspendedSshSessionsRef.value = [
          { suspendSessionId: 's1', connectionName: 'Server', customSuspendName: 'MyBox' },
        ];
        const handlers = await getRegisteredHandlers();

        handlers['SSH_SUSPEND_AUTO_TERMINATED']({
          suspendSessionId: 's1',
          reason: 'idle',
        });

        expect(mockAddNotification).toHaveBeenCalledWith(
          expect.objectContaining({ type: 'warning' }),
        );
      });

      it('会话不存在时不应崩溃', async () => {
        const handlers = await getRegisteredHandlers();

        expect(() =>
          handlers['SSH_SUSPEND_AUTO_TERMINATED']({
            suspendSessionId: 'nonexistent',
            reason: 'timeout',
          }),
        ).not.toThrow();
      });
    });
  });
});
