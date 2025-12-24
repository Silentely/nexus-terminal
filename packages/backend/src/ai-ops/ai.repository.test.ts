/**
 * AI Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as aiRepository from './ai.repository';
import type { AISession, AIMessage } from './ai.types';

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

describe('AI Repository', () => {
  const mockSessionId = 'session-001';
  const mockUserId = 1;
  const mockMessageId = 'msg-001';

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('createSession', () => {
    it('应成功创建会话', async () => {
      const session = await aiRepository.createSession(mockSessionId, mockUserId, 'Test Session');

      expect(getDbInstance).toHaveBeenCalled();
      expect(runDb).toHaveBeenCalledTimes(1);
      expect(session.sessionId).toBe(mockSessionId);
      expect(session.userId).toBe(mockUserId);
      expect(session.title).toBe('Test Session');
      expect(session.messages).toHaveLength(0);
      expect(session.createdAt).toBeInstanceOf(Date);
    });

    it('应支持无标题创建会话', async () => {
      const session = await aiRepository.createSession(mockSessionId, mockUserId);

      expect(session.title).toBeUndefined();
    });
  });

  describe('getSession', () => {
    it('会话不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await aiRepository.getSession('non-existent');

      expect(result).toBeNull();
    });

    it('应返回包含消息的完整会话', async () => {
      const mockSessionRow = {
        id: mockSessionId,
        user_id: mockUserId,
        title: 'Test Session',
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };

      const mockMessageRow = {
        id: mockMessageId,
        session_id: mockSessionId,
        role: 'user',
        content: 'Hello AI',
        timestamp: Math.floor(Date.now() / 1000),
        metadata_json: JSON.stringify({ source: 'web' }),
      };

      (getDb as any).mockResolvedValueOnce(mockSessionRow);
      (allDb as any).mockResolvedValueOnce([mockMessageRow]);

      const result = await aiRepository.getSession(mockSessionId);

      expect(result).not.toBeNull();
      expect(result?.sessionId).toBe(mockSessionId);
      expect(result?.userId).toBe(mockUserId);
      expect(result?.messages).toHaveLength(1);
      expect(result?.messages[0].role).toBe('user');
      expect(result?.messages[0].metadata?.source).toBe('web');
    });

    it('应支持消息分页', async () => {
      const mockSessionRow = {
        id: mockSessionId,
        user_id: mockUserId,
        title: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };

      (getDb as any).mockResolvedValueOnce(mockSessionRow);
      (allDb as any).mockResolvedValueOnce([]);

      await aiRepository.getSession(mockSessionId, 50, 10);

      expect(allDb).toHaveBeenCalled();
      const allDbCall = (allDb as any).mock.calls[0];
      expect(allDbCall[2]).toContain(50); // limit
      expect(allDbCall[2]).toContain(10); // offset
    });

    it('应正确处理无效的 metadata JSON', async () => {
      const mockSessionRow = {
        id: mockSessionId,
        user_id: mockUserId,
        title: null,
        created_at: Math.floor(Date.now() / 1000),
        updated_at: Math.floor(Date.now() / 1000),
      };

      const mockMessageRow = {
        id: mockMessageId,
        session_id: mockSessionId,
        role: 'assistant',
        content: 'Response',
        timestamp: Math.floor(Date.now() / 1000),
        metadata_json: 'invalid-json',
      };

      (getDb as any).mockResolvedValueOnce(mockSessionRow);
      (allDb as any).mockResolvedValueOnce([mockMessageRow]);

      const result = await aiRepository.getSession(mockSessionId);

      expect(result?.messages[0].metadata).toBeUndefined();
    });
  });

  describe('getSessionsByUser', () => {
    it('应返回用户的会话列表', async () => {
      const mockSessionRows = [
        {
          id: 'session-001',
          user_id: mockUserId,
          title: 'Session 1',
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
        {
          id: 'session-002',
          user_id: mockUserId,
          title: 'Session 2',
          created_at: Math.floor(Date.now() / 1000),
          updated_at: Math.floor(Date.now() / 1000),
        },
      ];

      (allDb as any).mockResolvedValueOnce(mockSessionRows);

      const result = await aiRepository.getSessionsByUser(mockUserId, 20, 0);

      expect(result).toHaveLength(2);
      expect(result[0].sessionId).toBe('session-001');
      expect(result[0].messages).toHaveLength(0); // 不含消息
    });

    it('用户无会话时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await aiRepository.getSessionsByUser(999);

      expect(result).toHaveLength(0);
    });
  });

  describe('updateSessionTitle', () => {
    it('应正确更新会话标题', async () => {
      await aiRepository.updateSessionTitle(mockSessionId, 'New Title');

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE ai_sessions');
      expect(call[2]).toContain('New Title');
    });
  });

  describe('touchSession', () => {
    it('应更新会话的 updated_at 时间戳', async () => {
      await aiRepository.touchSession(mockSessionId);

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE ai_sessions');
      expect(call[1]).toContain('updated_at');
    });
  });

  describe('deleteSession', () => {
    it('应删除会话', async () => {
      await aiRepository.deleteSession(mockSessionId);

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM ai_sessions');
    });
  });

  describe('addMessage', () => {
    it('应成功添加消息', async () => {
      const message = await aiRepository.addMessage(mockMessageId, mockSessionId, 'user', 'Hello', {
        source: 'web',
      });

      expect(runDb).toHaveBeenCalledTimes(2); // INSERT + touchSession
      expect(message.id).toBe(mockMessageId);
      expect(message.role).toBe('user');
      expect(message.content).toBe('Hello');
      expect(message.metadata?.source).toBe('web');
    });

    it('应支持无 metadata 的消息', async () => {
      const message = await aiRepository.addMessage(
        mockMessageId,
        mockSessionId,
        'assistant',
        'Response'
      );

      expect(message.metadata).toBeUndefined();
    });
  });

  describe('getMessages', () => {
    it('应返回会话的消息列表', async () => {
      const mockMessageRows = [
        {
          id: 'msg-001',
          session_id: mockSessionId,
          role: 'user',
          content: 'Question',
          timestamp: Math.floor(Date.now() / 1000),
          metadata_json: null,
        },
        {
          id: 'msg-002',
          session_id: mockSessionId,
          role: 'assistant',
          content: 'Answer',
          timestamp: Math.floor(Date.now() / 1000) + 1,
          metadata_json: null,
        },
      ];

      (allDb as any).mockResolvedValueOnce(mockMessageRows);

      const result = await aiRepository.getMessages(mockSessionId);

      expect(result).toHaveLength(2);
      expect(result[0].role).toBe('user');
      expect(result[1].role).toBe('assistant');
    });
  });

  describe('getRecentMessages', () => {
    it('应返回最近 N 条消息', async () => {
      const mockMessageRows = [
        {
          id: 'msg-001',
          session_id: mockSessionId,
          role: 'user',
          content: 'Recent 1',
          timestamp: Math.floor(Date.now() / 1000) - 10,
          metadata_json: null,
        },
        {
          id: 'msg-002',
          session_id: mockSessionId,
          role: 'assistant',
          content: 'Recent 2',
          timestamp: Math.floor(Date.now() / 1000),
          metadata_json: null,
        },
      ];

      (allDb as any).mockResolvedValueOnce(mockMessageRows);

      const result = await aiRepository.getRecentMessages(mockSessionId, 5);

      expect(result).toHaveLength(2);
    });
  });

  describe('deleteMessage', () => {
    it('应删除消息', async () => {
      await aiRepository.deleteMessage(mockMessageId);

      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('DELETE FROM ai_messages');
    });
  });

  describe('getSessionCount', () => {
    it('应返回用户的会话数量', async () => {
      (getDb as any).mockResolvedValueOnce({ count: 5 });

      const result = await aiRepository.getSessionCount(mockUserId);

      expect(result).toBe(5);
    });

    it('无会话时应返回 0', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await aiRepository.getSessionCount(mockUserId);

      expect(result).toBe(0);
    });
  });

  describe('cleanupOldSessions', () => {
    it('应清理旧会话保留最近 N 个', async () => {
      const mockKeepSessions = [{ id: 'session-001' }, { id: 'session-002' }];

      (allDb as any).mockResolvedValueOnce(mockKeepSessions);
      (runDb as any).mockResolvedValueOnce({ changes: 3 });

      const result = await aiRepository.cleanupOldSessions(mockUserId, 2);

      expect(result).toBe(3);
      expect(allDb).toHaveBeenCalled();
      expect(runDb).toHaveBeenCalled();
    });

    it('无会话时应返回 0', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await aiRepository.cleanupOldSessions(mockUserId, 50);

      expect(result).toBe(0);
    });
  });

  describe('isSessionOwnedByUser', () => {
    it('会话属于用户时应返回 true', async () => {
      (getDb as any).mockResolvedValueOnce({ count: 1 });

      const result = await aiRepository.isSessionOwnedByUser(mockSessionId, mockUserId);

      expect(result).toBe(true);
    });

    it('会话不属于用户时应返回 false', async () => {
      (getDb as any).mockResolvedValueOnce({ count: 0 });

      const result = await aiRepository.isSessionOwnedByUser(mockSessionId, 999);

      expect(result).toBe(false);
    });

    it('查询结果为 null 时应返回 false', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await aiRepository.isSessionOwnedByUser(mockSessionId, mockUserId);

      expect(result).toBe(false);
    });
  });
});
