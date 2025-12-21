/**
 * IP Blacklist Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
    getDbInstance: vi.fn().mockResolvedValue({}),
    runDb: vi.fn().mockResolvedValue({ changes: 1 }),
    getDb: vi.fn(),
    allDb: vi.fn().mockResolvedValue([]),
}));

// Mock settings service
vi.mock('../settings/settings.service', () => ({
    settingsService: {
        isIpBlacklistEnabled: vi.fn().mockResolvedValue(true),
        getSetting: vi.fn().mockResolvedValue('5'),
    },
}));

// Mock notification service
vi.mock('../notifications/notification.service', () => ({
    NotificationService: vi.fn().mockImplementation(() => ({
        sendNotification: vi.fn().mockResolvedValue(undefined),
    })),
}));

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import { settingsService } from '../settings/settings.service';
import {
    IpBlacklistService,
    ipBlacklistService,
} from './ip-blacklist.service';

describe('IpBlacklistService', () => {
    let service: IpBlacklistService;

    beforeEach(() => {
        service = new IpBlacklistService();
        vi.clearAllMocks();
        // 默认启用 IP 黑名单
        (settingsService.isIpBlacklistEnabled as any).mockResolvedValue(true);
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('isBlocked', () => {
        it('功能禁用时应返回 false', async () => {
            (settingsService.isIpBlacklistEnabled as any).mockResolvedValueOnce(false);

            const result = await service.isBlocked('192.168.1.100');

            expect(result).toBe(false);
            expect(getDb).not.toHaveBeenCalled();
        });

        it('IP 被封禁且未过期时应返回 true', async () => {
            const mockRecord = {
                ip: '192.168.1.100',
                attempts: 5,
                last_attempt_at: Math.floor(Date.now() / 1000),
                blocked_until: Math.floor(Date.now() / 1000) + 3600, // 1小时后
            };

            (getDb as any).mockResolvedValueOnce(mockRecord);

            const result = await service.isBlocked('192.168.1.100');

            expect(result).toBe(true);
        });

        it('IP 未被封禁时应返回 false', async () => {
            (getDb as any).mockResolvedValueOnce(null);

            const result = await service.isBlocked('192.168.1.200');

            expect(result).toBe(false);
        });

        it('封禁已过期时应返回 false', async () => {
            const mockRecord = {
                ip: '192.168.1.100',
                attempts: 5,
                last_attempt_at: Math.floor(Date.now() / 1000) - 7200,
                blocked_until: Math.floor(Date.now() / 1000) - 3600, // 1小时前过期
            };

            (getDb as any).mockResolvedValueOnce(mockRecord);

            const result = await service.isBlocked('192.168.1.100');

            expect(result).toBe(false);
        });

        it('记录存在但 blocked_until 为 null 时应返回 false', async () => {
            const mockRecord = {
                ip: '192.168.1.100',
                attempts: 3,
                last_attempt_at: Math.floor(Date.now() / 1000),
                blocked_until: null,
            };

            (getDb as any).mockResolvedValueOnce(mockRecord);

            const result = await service.isBlocked('192.168.1.100');

            expect(result).toBe(false);
        });
    });

    describe('recordFailedAttempt', () => {
        it('功能禁用时不应记录', async () => {
            (settingsService.isIpBlacklistEnabled as any).mockResolvedValueOnce(false);

            await service.recordFailedAttempt('192.168.1.100');

            expect(runDb).not.toHaveBeenCalled();
        });

        it('本地 IP 应跳过记录', async () => {
            await service.recordFailedAttempt('127.0.0.1');

            expect(runDb).not.toHaveBeenCalled();
        });

        it('新 IP 应创建记录', async () => {
            (settingsService.getSetting as any).mockResolvedValueOnce('5'); // maxAttempts
            (settingsService.getSetting as any).mockResolvedValueOnce('300'); // banDuration
            (getDb as any).mockResolvedValueOnce(null); // 不存在记录

            await service.recordFailedAttempt('192.168.1.100');

            expect(runDb).toHaveBeenCalled();
            const call = (runDb as any).mock.calls[0];
            expect(call[1]).toContain('INSERT');
        });

        it('已存在记录应更新尝试次数', async () => {
            const mockRecord = {
                ip: '192.168.1.100',
                attempts: 2,
                last_attempt_at: Math.floor(Date.now() / 1000) - 60,
                blocked_until: null,
            };

            (settingsService.getSetting as any).mockResolvedValueOnce('5'); // maxAttempts
            (settingsService.getSetting as any).mockResolvedValueOnce('300'); // banDuration
            (getDb as any).mockResolvedValueOnce(mockRecord);

            await service.recordFailedAttempt('192.168.1.100');

            expect(runDb).toHaveBeenCalled();
            const call = (runDb as any).mock.calls[0];
            expect(call[1]).toContain('UPDATE');
        });

        it('达到阈值时应设置封禁时间', async () => {
            const mockRecord = {
                ip: '192.168.1.100',
                attempts: 4, // 即将达到阈值
                last_attempt_at: Math.floor(Date.now() / 1000) - 60,
                blocked_until: null,
            };

            (settingsService.getSetting as any).mockResolvedValueOnce('5'); // maxAttempts
            (settingsService.getSetting as any).mockResolvedValueOnce('300'); // banDuration
            (getDb as any).mockResolvedValueOnce(mockRecord);

            await service.recordFailedAttempt('192.168.1.100');

            expect(runDb).toHaveBeenCalled();
            const call = (runDb as any).mock.calls[0];
            expect(call[2][2]).not.toBeNull(); // blocked_until 应该被设置
        });
    });

    describe('resetAttempts', () => {
        it('应删除 IP 的记录', async () => {
            await service.resetAttempts('192.168.1.100');

            expect(runDb).toHaveBeenCalled();
            const call = (runDb as any).mock.calls[0];
            expect(call[1]).toContain('DELETE');
            expect(call[2]).toContain('192.168.1.100');
        });
    });

    describe('getBlacklist', () => {
        it('应返回黑名单列表和总数', async () => {
            const mockRecords = [
                {
                    ip: '192.168.1.100',
                    attempts: 5,
                    last_attempt_at: Math.floor(Date.now() / 1000),
                    blocked_until: Math.floor(Date.now() / 1000) + 3600,
                },
                {
                    ip: '192.168.1.101',
                    attempts: 3,
                    last_attempt_at: Math.floor(Date.now() / 1000),
                    blocked_until: null,
                },
            ];

            (allDb as any).mockResolvedValueOnce(mockRecords);
            (getDb as any).mockResolvedValueOnce({ count: 2 });

            const result = await service.getBlacklist(50, 0);

            expect(result.entries).toHaveLength(2);
            expect(result.total).toBe(2);
            expect(result.entries[0].ip).toBe('192.168.1.100');
        });

        it('无记录时应返回空数组和 0', async () => {
            (allDb as any).mockResolvedValueOnce([]);
            (getDb as any).mockResolvedValueOnce({ count: 0 });

            const result = await service.getBlacklist();

            expect(result.entries).toHaveLength(0);
            expect(result.total).toBe(0);
        });
    });

    describe('removeFromBlacklist', () => {
        it('应成功删除并返回 true', async () => {
            (runDb as any).mockResolvedValueOnce({ changes: 1 });

            const result = await service.removeFromBlacklist('192.168.1.100');

            expect(result).toBe(true);
            expect(runDb).toHaveBeenCalled();
        });

        it('IP 不存在时应返回 false', async () => {
            (runDb as any).mockResolvedValueOnce({ changes: 0 });

            const result = await service.removeFromBlacklist('192.168.1.200');

            expect(result).toBe(false);
        });
    });

    describe('ipBlacklistService 单例', () => {
        it('应导出一个 IpBlacklistService 实例', () => {
            expect(ipBlacklistService).toBeInstanceOf(IpBlacklistService);
        });
    });
});
