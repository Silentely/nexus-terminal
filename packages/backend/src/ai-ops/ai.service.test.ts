/**
 * AI Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock uuid
vi.mock('uuid', () => ({
    v4: vi.fn(() => 'mock-uuid-1234'),
}));

// Mock 数据库连接
vi.mock('../database/connection', () => ({
    getDbInstance: vi.fn().mockResolvedValue({}),
    getDb: vi.fn(),
    allDb: vi.fn().mockResolvedValue([]),
}));

// Mock AI Repository
vi.mock('./ai.repository', () => ({
    getSession: vi.fn(),
    createSession: vi.fn(),
    addMessage: vi.fn(),
    getMessages: vi.fn().mockResolvedValue([]),
    updateSessionTitle: vi.fn(),
    getSessionsByUser: vi.fn().mockResolvedValue([]),
    isSessionOwnedByUser: vi.fn(),
    deleteSession: vi.fn(),
    cleanupOldSessions: vi.fn().mockResolvedValue(0),
}));

// Mock WebSocket state
vi.mock('../websocket/state', () => ({
    clientStates: new Map(),
    userSockets: new Map(),
}));

import { getDb, allDb } from '../database/connection';
import * as AIRepository from './ai.repository';
import { clientStates, userSockets } from '../websocket/state';
import {
    getOrCreateSession,
    processQuery,
    getSystemHealthSummary,
    analyzeCommandPatterns,
    getUserSessions,
    getSessionDetails,
    deleteSession,
    cleanupUserSessions,
} from './ai.service';

describe('AI Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        (clientStates as Map<any, any>).clear();
        (userSockets as Map<any, any>).clear();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('getOrCreateSession', () => {
        it('应返回现有会话（如果属于该用户）', async () => {
            const mockSession = {
                sessionId: 'existing-session',
                userId: 1,
                title: 'Test Session',
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            (AIRepository.getSession as any).mockResolvedValueOnce(mockSession);

            const result = await getOrCreateSession(1, 'existing-session');

            expect(result).toEqual(mockSession);
            expect(AIRepository.createSession).not.toHaveBeenCalled();
        });

        it('会话不属于用户时应创建新会话', async () => {
            const existingSession = {
                sessionId: 'other-user-session',
                userId: 2,
                title: 'Other User Session',
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            const newSession = {
                sessionId: 'mock-uuid-1234',
                userId: 1,
                title: '新对话',
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            (AIRepository.getSession as any).mockResolvedValueOnce(existingSession);
            (AIRepository.createSession as any).mockResolvedValueOnce(newSession);

            const result = await getOrCreateSession(1, 'other-user-session');

            expect(AIRepository.createSession).toHaveBeenCalled();
            expect(result.sessionId).toBe('mock-uuid-1234');
        });

        it('无 sessionId 时应创建新会话', async () => {
            const newSession = {
                sessionId: 'mock-uuid-1234',
                userId: 1,
                title: '新对话',
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            (AIRepository.createSession as any).mockResolvedValueOnce(newSession);

            const result = await getOrCreateSession(1);

            expect(AIRepository.createSession).toHaveBeenCalledWith('mock-uuid-1234', 1, '新对话');
        });
    });

    describe('processQuery', () => {
        beforeEach(() => {
            const mockSession = {
                sessionId: 'test-session',
                userId: 1,
                title: 'Test',
                messages: [],
                createdAt: new Date(),
                updatedAt: new Date(),
            };
            (AIRepository.getSession as any).mockResolvedValue(mockSession);
            (AIRepository.createSession as any).mockResolvedValue(mockSession);
            (AIRepository.addMessage as any).mockResolvedValue({
                id: 'msg-1',
                role: 'assistant',
                content: 'Response',
                timestamp: new Date(),
            });
            // Mock database queries for health check
            (getDb as any).mockResolvedValue({ count: 0 });
            (allDb as any).mockResolvedValue([]);
        });

        it('应处理健康状态查询', async () => {
            const result = await processQuery(1, {
                query: '系统健康状态如何？',
            });

            expect(result.success).toBe(true);
            expect(result.sessionId).toBeDefined();
            expect(AIRepository.addMessage).toHaveBeenCalledTimes(2); // user + assistant
        });

        it('应处理命令模式查询', async () => {
            const result = await processQuery(1, {
                query: '分析命令执行模式',
            });

            expect(result.success).toBe(true);
            expect(result.suggestions).toBeDefined();
        });

        it('应处理安全相关查询', async () => {
            const result = await processQuery(1, {
                query: '检查登录安全情况',
            });

            expect(result.success).toBe(true);
        });

        it('应处理连接相关查询', async () => {
            const result = await processQuery(1, {
                query: 'SSH 连接状态怎么样？',
            });

            expect(result.success).toBe(true);
        });

        it('应处理通用查询', async () => {
            const result = await processQuery(1, {
                query: '你好，请帮帮我',
            });

            expect(result.success).toBe(true);
            expect(result.suggestions).toBeDefined();
        });
    });

    describe('getSystemHealthSummary', () => {
        it('应返回系统健康摘要', async () => {
            (getDb as any).mockResolvedValue({ count: 0 });
            (allDb as any).mockResolvedValue([]);

            const result = await getSystemHealthSummary(1);

            expect(result.overallStatus).toBe('healthy');
            expect(result.activeConnections).toBe(0);
            expect(result.failedLoginAttempts24h).toBe(0);
        });

        it('登录失败次数多时应返回 warning 状态', async () => {
            (getDb as any)
                .mockResolvedValueOnce({ count: 6 }) // failedLogins
                .mockResolvedValueOnce({ count: 0 }) // sshFailures
                .mockResolvedValueOnce({ count: 10 }); // commands
            (allDb as any).mockResolvedValue([]);

            const result = await getSystemHealthSummary();

            expect(result.overallStatus).toBe('warning');
            expect(result.recentAlerts.length).toBeGreaterThan(0);
        });

        it('登录失败次数过多时应返回 critical 状态', async () => {
            (getDb as any)
                .mockResolvedValueOnce({ count: 15 }) // failedLogins
                .mockResolvedValueOnce({ count: 0 }) // sshFailures
                .mockResolvedValueOnce({ count: 10 }); // commands
            (allDb as any).mockResolvedValue([]);

            const result = await getSystemHealthSummary();

            expect(result.overallStatus).toBe('critical');
        });

        it('应统计用户活跃连接', async () => {
            // Setup mock WebSocket state
            const mockWs = {} as any;
            const mockState = { sshClient: {} };
            (clientStates as Map<any, any>).set(mockWs, mockState);
            const userSocketSet = new Set([mockWs]);
            (userSockets as Map<any, any>).set('1', userSocketSet);

            (getDb as any).mockResolvedValue({ count: 0 });
            (allDb as any).mockResolvedValue([]);

            const result = await getSystemHealthSummary(1);

            expect(result.activeConnections).toBe(1);
        });
    });

    describe('analyzeCommandPatterns', () => {
        it('应返回命令模式分析', async () => {
            (getDb as any).mockResolvedValueOnce({ count: 100 });
            (allDb as any)
                .mockResolvedValueOnce([
                    { cmd_name: 'ls', count: 50 },
                    { cmd_name: 'cd', count: 30 },
                ])
                .mockResolvedValueOnce([
                    { hour: 9, count: 20 },
                    { hour: 14, count: 40 },
                ])
                .mockResolvedValueOnce([]) // rm -rf
                .mockResolvedValueOnce([]) // dd if=
                .mockResolvedValueOnce([]) // mkfs
                .mockResolvedValueOnce([]) // :(){
                .mockResolvedValueOnce([]) // > /dev/sd
                .mockResolvedValueOnce([]); // chmod 777

            const result = await analyzeCommandPatterns(1);

            expect(result.totalCommands).toBe(100);
            expect(result.topCommands.length).toBe(2);
            expect(result.topCommands[0].command).toBe('ls');
        });

        it('应检测危险命令', async () => {
            (getDb as any).mockResolvedValueOnce({ count: 10 });
            (allDb as any)
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([{ command: 'rm -rf /' }]) // 检测到危险命令
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([])
                .mockResolvedValueOnce([]);

            const result = await analyzeCommandPatterns();

            expect(result.unusualCommands).toContain('rm -rf /');
        });
    });

    describe('getUserSessions', () => {
        it('应返回用户会话列表', async () => {
            const mockSessions = [
                { sessionId: 'session-1', userId: 1, title: 'Session 1' },
                { sessionId: 'session-2', userId: 1, title: 'Session 2' },
            ];
            (AIRepository.getSessionsByUser as any).mockResolvedValueOnce(mockSessions);

            const result = await getUserSessions(1, 50, 0);

            expect(result).toEqual(mockSessions);
            expect(AIRepository.getSessionsByUser).toHaveBeenCalledWith(1, 50, 0);
        });
    });

    describe('getSessionDetails', () => {
        it('应返回会话详情（如果用户拥有）', async () => {
            const mockSession = {
                sessionId: 'session-1',
                userId: 1,
                title: 'Session 1',
                messages: [],
            };
            (AIRepository.isSessionOwnedByUser as any).mockResolvedValueOnce(true);
            (AIRepository.getSession as any).mockResolvedValueOnce(mockSession);

            const result = await getSessionDetails('session-1', 1);

            expect(result).toEqual(mockSession);
        });

        it('会话不属于用户时应返回 null', async () => {
            (AIRepository.isSessionOwnedByUser as any).mockResolvedValueOnce(false);

            const result = await getSessionDetails('session-1', 2);

            expect(result).toBeNull();
        });
    });

    describe('deleteSession', () => {
        it('应成功删除用户拥有的会话', async () => {
            (AIRepository.isSessionOwnedByUser as any).mockResolvedValueOnce(true);

            const result = await deleteSession('session-1', 1);

            expect(result).toBe(true);
            expect(AIRepository.deleteSession).toHaveBeenCalledWith('session-1');
        });

        it('会话不属于用户时应返回 false', async () => {
            (AIRepository.isSessionOwnedByUser as any).mockResolvedValueOnce(false);

            const result = await deleteSession('session-1', 2);

            expect(result).toBe(false);
            expect(AIRepository.deleteSession).not.toHaveBeenCalled();
        });
    });

    describe('cleanupUserSessions', () => {
        it('应清理旧会话', async () => {
            (AIRepository.cleanupOldSessions as any).mockResolvedValueOnce(5);

            const result = await cleanupUserSessions(1, 50);

            expect(result).toBe(5);
            expect(AIRepository.cleanupOldSessions).toHaveBeenCalledWith(1, 50);
        });
    });
});
