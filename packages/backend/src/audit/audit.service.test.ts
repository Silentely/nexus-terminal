/**
 * Audit Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock AuditLogRepository
vi.mock('./audit.repository', () => ({
    AuditLogRepository: vi.fn().mockImplementation(() => ({
        addLog: vi.fn().mockResolvedValue(undefined),
        getLogs: vi.fn().mockResolvedValue({ logs: [], total: 0 }),
    })),
}));

import { AuditLogService } from './audit.service';
import { AuditLogRepository } from './audit.repository';

describe('AuditLogService', () => {
    let service: AuditLogService;
    let mockRepository: any;

    beforeEach(() => {
        vi.clearAllMocks();
        service = new AuditLogService();
        // 获取 mock 的 repository 实例
        mockRepository = (AuditLogRepository as any).mock.results[0].value;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    describe('logAction', () => {
        it('应成功记录审计日志', async () => {
            await service.logAction('user_login', { username: 'admin' });

            expect(mockRepository.addLog).toHaveBeenCalledWith('user_login', { username: 'admin' });
        });

        it('应支持字符串类型的 details', async () => {
            await service.logAction('user_logout', 'Session ended');

            expect(mockRepository.addLog).toHaveBeenCalledWith('user_logout', 'Session ended');
        });

        it('应支持 null details', async () => {
            await service.logAction('user_logout', null);

            expect(mockRepository.addLog).toHaveBeenCalledWith('user_logout', null);
        });

        it('应支持无 details 参数', async () => {
            await service.logAction('user_logout');

            expect(mockRepository.addLog).toHaveBeenCalledWith('user_logout', undefined);
        });

        it('repository 错误时不应抛出异常', async () => {
            mockRepository.addLog.mockRejectedValueOnce(new Error('Repository error'));

            // 不应抛出异常
            await expect(service.logAction('user_login')).resolves.toBeUndefined();
        });
    });

    describe('getLogs', () => {
        it('应返回审计日志列表', async () => {
            const mockResult = {
                logs: [
                    { id: 1, timestamp: 1000, action_type: 'user_login', details: null },
                ],
                total: 1,
            };
            mockRepository.getLogs.mockResolvedValueOnce(mockResult);

            const result = await service.getLogs(50, 0);

            expect(result).toEqual(mockResult);
            expect(mockRepository.getLogs).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined, undefined);
        });

        it('应使用默认分页参数', async () => {
            await service.getLogs();

            expect(mockRepository.getLogs).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined, undefined);
        });

        it('应传递 actionType 过滤参数', async () => {
            await service.getLogs(50, 0, 'user_login');

            expect(mockRepository.getLogs).toHaveBeenCalledWith(50, 0, 'user_login', undefined, undefined, undefined);
        });

        it('应传递 startDate 和 endDate 参数', async () => {
            await service.getLogs(50, 0, undefined, 1000, 2000);

            expect(mockRepository.getLogs).toHaveBeenCalledWith(50, 0, undefined, 1000, 2000, undefined);
        });

        it('应传递 searchTerm 参数', async () => {
            await service.getLogs(50, 0, undefined, undefined, undefined, 'admin');

            expect(mockRepository.getLogs).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined, 'admin');
        });

        it('应传递所有过滤参数', async () => {
            await service.getLogs(20, 10, 'user_login', 1000, 2000, 'admin');

            expect(mockRepository.getLogs).toHaveBeenCalledWith(20, 10, 'user_login', 1000, 2000, 'admin');
        });
    });
});
