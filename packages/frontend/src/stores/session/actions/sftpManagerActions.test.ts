import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/utils/log', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../../../composables/useSftpActions', () => ({
  createSftpActionsManager: vi.fn(() => ({
    cleanup: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
  })),
}));

const { mockSessionsMap } = vi.hoisted(() => ({
  mockSessionsMap: new Map(),
}));

vi.mock('../state', () => ({
  sessions: {
    get value() {
      return mockSessionsMap;
    },
  },
}));

import { getOrCreateSftpManager, removeSftpManager } from './sftpManagerActions';
import { log } from '@/utils/log';
import { createSftpActionsManager } from '../../../composables/useSftpActions';

const createMockSession = (sessionId: string) => ({
  sessionId,
  wsManager: {
    sendMessage: vi.fn(),
    onMessage: vi.fn(),
    isConnected: { value: true },
    isSftpReady: { value: true },
  },
  sftpManagers: new Map(),
});

describe('session/actions/sftpManagerActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionsMap.clear();
  });

  describe('getOrCreateSftpManager', () => {
    it('会话不存在时应返回 null', () => {
      const result = getOrCreateSftpManager('nonexistent', 'instance-1', { t: vi.fn() });
      expect(result).toBeNull();
      expect(log.error).toHaveBeenCalled();
    });

    it('会话存在时应创建新的 SFTP 管理器', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      const mockManager = { cleanup: vi.fn() };
      vi.mocked(createSftpActionsManager).mockReturnValue(mockManager as never);

      const t = vi.fn((key: string) => key);
      const result = getOrCreateSftpManager('s1', 'instance-1', { t });

      expect(result).toBe(mockManager);
      expect(createSftpActionsManager).toHaveBeenCalledTimes(1);
      expect(session.sftpManagers.get('instance-1')).toBe(mockManager);
    });

    it('已有管理器时应返回现有实例', () => {
      const session = createMockSession('s1');
      const existingManager = { cleanup: vi.fn() };
      session.sftpManagers.set('instance-1', existingManager as never);
      mockSessionsMap.set('s1', session);

      const result = getOrCreateSftpManager('s1', 'instance-1', { t: vi.fn() });

      expect(result).toBe(existingManager);
      expect(createSftpActionsManager).not.toHaveBeenCalled();
    });

    it('不同的 instanceId 应创建不同的管理器', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      const manager1 = { cleanup: vi.fn() };
      const manager2 = { cleanup: vi.fn() };
      vi.mocked(createSftpActionsManager)
        .mockReturnValueOnce(manager1 as never)
        .mockReturnValueOnce(manager2 as never);

      const t = vi.fn((key: string) => key);
      getOrCreateSftpManager('s1', 'instance-1', { t });
      getOrCreateSftpManager('s1', 'instance-2', { t });

      expect(session.sftpManagers.get('instance-1')).toBe(manager1);
      expect(session.sftpManagers.get('instance-2')).toBe(manager2);
    });

    it('应传入 initialPath 给管理器', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      const t = vi.fn((key: string) => key);
      getOrCreateSftpManager('s1', 'instance-1', { t }, '/home/user');

      expect(createSftpActionsManager).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ value: '/home/user' }),
        expect.anything(),
        t,
      );
    });

    it('不传 initialPath 时默认使用 /', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      const t = vi.fn((key: string) => key);
      getOrCreateSftpManager('s1', 'instance-1', { t });

      expect(createSftpActionsManager).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({ value: '/' }),
        expect.anything(),
        t,
      );
    });
  });

  describe('removeSftpManager', () => {
    it('会话不存在时不应抛出异常', () => {
      expect(() => removeSftpManager('nonexistent', 'instance-1')).not.toThrow();
    });

    it('管理器存在时应调用 cleanup 并删除', () => {
      const session = createMockSession('s1');
      const mockManager = { cleanup: vi.fn() };
      session.sftpManagers.set('instance-1', mockManager as never);
      mockSessionsMap.set('s1', session);

      removeSftpManager('s1', 'instance-1');

      expect(mockManager.cleanup).toHaveBeenCalledTimes(1);
      expect(session.sftpManagers.has('instance-1')).toBe(false);
      expect(log.info).toHaveBeenCalled();
    });

    it('管理器不存在时不应调用 cleanup', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      removeSftpManager('s1', 'nonexistent');

      // 不应调用 cleanup，因为没有对应的管理器
    });

    it('会话存在但 sftpManagers 为空时不应抛出异常', () => {
      const session = createMockSession('s1');
      mockSessionsMap.set('s1', session);

      expect(() => removeSftpManager('s1', 'instance-1')).not.toThrow();
    });

    it('多个实例应独立管理', () => {
      const session = createMockSession('s1');
      const manager1 = { cleanup: vi.fn() };
      const manager2 = { cleanup: vi.fn() };
      session.sftpManagers.set('i1', manager1 as never);
      session.sftpManagers.set('i2', manager2 as never);
      mockSessionsMap.set('s1', session);

      removeSftpManager('s1', 'i1');

      expect(manager1.cleanup).toHaveBeenCalled();
      expect(manager2.cleanup).not.toHaveBeenCalled();
      expect(session.sftpManagers.has('i1')).toBe(false);
      expect(session.sftpManagers.has('i2')).toBe(true);
    });
  });
});
