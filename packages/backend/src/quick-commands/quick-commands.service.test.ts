/**
 * Quick Commands Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Quick Commands Repository
vi.mock('./quick-commands.repository', () => ({
    addQuickCommand: vi.fn(),
    updateQuickCommand: vi.fn(),
    deleteQuickCommand: vi.fn(),
    getAllQuickCommands: vi.fn(),
    incrementUsageCount: vi.fn(),
    findQuickCommandById: vi.fn(),
}));

// Mock Quick Command Tag Repository
vi.mock('../quick-command-tags/quick-command-tag.repository', () => ({
    setCommandTagAssociations: vi.fn(),
    addTagToCommands: vi.fn(),
}));

import * as QuickCommandsRepository from './quick-commands.repository';
import * as QuickCommandTagRepository from '../quick-command-tags/quick-command-tag.repository';
import {
    addQuickCommand,
    updateQuickCommand,
    deleteQuickCommand,
    getAllQuickCommands,
    incrementUsageCount,
    getQuickCommandById,
    assignTagToCommands,
} from './quick-commands.service';

describe('Quick Commands Service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    describe('addQuickCommand', () => {
        it('应成功添加快捷指令', async () => {
            (QuickCommandsRepository.addQuickCommand as any).mockResolvedValueOnce(5);

            const result = await addQuickCommand('List Files', 'ls -la');

            expect(result).toBe(5);
            expect(QuickCommandsRepository.addQuickCommand).toHaveBeenCalledWith('List Files', 'ls -la', undefined);
        });

        it('应对名称进行 trim 处理', async () => {
            (QuickCommandsRepository.addQuickCommand as any).mockResolvedValueOnce(5);

            await addQuickCommand('  Name with spaces  ', 'command');

            expect(QuickCommandsRepository.addQuickCommand).toHaveBeenCalledWith('Name with spaces', 'command', undefined);
        });

        it('空名称应转换为 null', async () => {
            (QuickCommandsRepository.addQuickCommand as any).mockResolvedValueOnce(5);

            await addQuickCommand('   ', 'command');

            expect(QuickCommandsRepository.addQuickCommand).toHaveBeenCalledWith(null, 'command', undefined);
        });

        it('空指令内容应抛出异常', async () => {
            await expect(addQuickCommand('Name', '')).rejects.toThrow('指令内容不能为空');
            await expect(addQuickCommand('Name', '   ')).rejects.toThrow('指令内容不能为空');
        });

        it('应支持关联标签', async () => {
            (QuickCommandsRepository.addQuickCommand as any).mockResolvedValueOnce(5);
            (QuickCommandTagRepository.setCommandTagAssociations as any).mockResolvedValueOnce(undefined);

            await addQuickCommand('Name', 'command', [1, 2, 3]);

            expect(QuickCommandTagRepository.setCommandTagAssociations).toHaveBeenCalledWith(5, [1, 2, 3]);
        });

        it('标签关联失败不应影响主记录创建', async () => {
            (QuickCommandsRepository.addQuickCommand as any).mockResolvedValueOnce(5);
            (QuickCommandTagRepository.setCommandTagAssociations as any).mockRejectedValueOnce(new Error('Tag error'));

            const result = await addQuickCommand('Name', 'command', [1, 2]);

            expect(result).toBe(5);
        });

        it('应支持带变量的快捷指令', async () => {
            (QuickCommandsRepository.addQuickCommand as any).mockResolvedValueOnce(5);

            const variables = { host: 'server1' };
            await addQuickCommand('Name', 'ssh {{host}}', undefined, variables);

            expect(QuickCommandsRepository.addQuickCommand).toHaveBeenCalledWith('Name', 'ssh {{host}}', variables);
        });
    });

    describe('updateQuickCommand', () => {
        it('应成功更新快捷指令', async () => {
            (QuickCommandsRepository.updateQuickCommand as any).mockResolvedValueOnce(true);

            const result = await updateQuickCommand(1, 'Updated Name', 'updated command');

            expect(result).toBe(true);
            expect(QuickCommandsRepository.updateQuickCommand).toHaveBeenCalledWith(1, 'Updated Name', 'updated command', undefined);
        });

        it('空指令内容应抛出异常', async () => {
            await expect(updateQuickCommand(1, 'Name', '')).rejects.toThrow('指令内容不能为空');
        });

        it('应支持更新标签关联', async () => {
            (QuickCommandsRepository.updateQuickCommand as any).mockResolvedValueOnce(true);
            (QuickCommandTagRepository.setCommandTagAssociations as any).mockResolvedValueOnce(undefined);

            await updateQuickCommand(1, 'Name', 'command', [4, 5]);

            expect(QuickCommandTagRepository.setCommandTagAssociations).toHaveBeenCalledWith(1, [4, 5]);
        });

        it('tagIds 为 undefined 时不应更新标签关联', async () => {
            (QuickCommandsRepository.updateQuickCommand as any).mockResolvedValueOnce(true);

            await updateQuickCommand(1, 'Name', 'command', undefined);

            expect(QuickCommandTagRepository.setCommandTagAssociations).not.toHaveBeenCalled();
        });

        it('指令不存在时应返回 false', async () => {
            (QuickCommandsRepository.updateQuickCommand as any).mockResolvedValueOnce(false);

            const result = await updateQuickCommand(999, 'Name', 'command');

            expect(result).toBe(false);
        });
    });

    describe('deleteQuickCommand', () => {
        it('应成功删除快捷指令', async () => {
            (QuickCommandsRepository.deleteQuickCommand as any).mockResolvedValueOnce(true);

            const result = await deleteQuickCommand(1);

            expect(result).toBe(true);
            expect(QuickCommandsRepository.deleteQuickCommand).toHaveBeenCalledWith(1);
        });

        it('指令不存在时应返回 false', async () => {
            (QuickCommandsRepository.deleteQuickCommand as any).mockResolvedValueOnce(false);

            const result = await deleteQuickCommand(999);

            expect(result).toBe(false);
        });
    });

    describe('getAllQuickCommands', () => {
        it('应返回所有快捷指令（默认按名称排序）', async () => {
            const mockCommands = [
                { id: 1, name: 'Alpha', command: 'cmd1', usage_count: 5, tagIds: [1], variables: null, created_at: 1000, updated_at: 1000 },
            ];
            (QuickCommandsRepository.getAllQuickCommands as any).mockResolvedValueOnce(mockCommands);

            const result = await getAllQuickCommands();

            expect(result).toEqual(mockCommands);
            expect(QuickCommandsRepository.getAllQuickCommands).toHaveBeenCalledWith('name');
        });

        it('应支持按使用频率排序', async () => {
            (QuickCommandsRepository.getAllQuickCommands as any).mockResolvedValueOnce([]);

            await getAllQuickCommands('usage_count');

            expect(QuickCommandsRepository.getAllQuickCommands).toHaveBeenCalledWith('usage_count');
        });
    });

    describe('incrementUsageCount', () => {
        it('应成功增加使用次数', async () => {
            (QuickCommandsRepository.incrementUsageCount as any).mockResolvedValueOnce(true);

            const result = await incrementUsageCount(1);

            expect(result).toBe(true);
            expect(QuickCommandsRepository.incrementUsageCount).toHaveBeenCalledWith(1);
        });
    });

    describe('getQuickCommandById', () => {
        it('应返回指定 ID 的快捷指令', async () => {
            const mockCommand = { id: 1, name: 'Test', command: 'cmd', usage_count: 10, tagIds: [1, 2], variables: null, created_at: 1000, updated_at: 1000 };
            (QuickCommandsRepository.findQuickCommandById as any).mockResolvedValueOnce(mockCommand);

            const result = await getQuickCommandById(1);

            expect(result).toEqual(mockCommand);
            expect(QuickCommandsRepository.findQuickCommandById).toHaveBeenCalledWith(1);
        });

        it('指令不存在时应返回 undefined', async () => {
            (QuickCommandsRepository.findQuickCommandById as any).mockResolvedValueOnce(undefined);

            const result = await getQuickCommandById(999);

            expect(result).toBeUndefined();
        });
    });

    describe('assignTagToCommands', () => {
        it('应成功批量关联标签到多个指令', async () => {
            (QuickCommandTagRepository.addTagToCommands as any).mockResolvedValueOnce(undefined);

            await expect(assignTagToCommands([1, 2, 3], 5)).resolves.toBeUndefined();

            expect(QuickCommandTagRepository.addTagToCommands).toHaveBeenCalledWith([1, 2, 3], 5);
        });

        it('无效的指令 ID 列表应抛出异常', async () => {
            await expect(assignTagToCommands([1, NaN, 3], 5)).rejects.toThrow('无效的指令 ID 列表');
            await expect(assignTagToCommands('not array' as any, 5)).rejects.toThrow('无效的指令 ID 列表');
        });

        it('无效的标签 ID 应抛出异常', async () => {
            await expect(assignTagToCommands([1, 2], NaN)).rejects.toThrow('无效的标签 ID');
            await expect(assignTagToCommands([1, 2], 'string' as any)).rejects.toThrow('无效的标签 ID');
        });

        it('repository 错误应向上传递', async () => {
            (QuickCommandTagRepository.addTagToCommands as any).mockRejectedValueOnce(new Error('Repo error'));

            await expect(assignTagToCommands([1, 2], 5)).rejects.toThrow('Repo error');
        });
    });
});
