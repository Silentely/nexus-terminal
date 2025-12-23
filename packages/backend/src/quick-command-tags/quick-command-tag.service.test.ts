/**
 * Quick Command Tag Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock Quick Command Tag Repository
vi.mock('./quick-command-tag.repository', () => ({
  findAllQuickCommandTags: vi.fn(),
  findQuickCommandTagById: vi.fn(),
  createQuickCommandTag: vi.fn(),
  updateQuickCommandTag: vi.fn(),
  deleteQuickCommandTag: vi.fn(),
  setCommandTagAssociations: vi.fn(),
  findTagsByCommandId: vi.fn(),
}));

import * as QuickCommandTagRepository from './quick-command-tag.repository';
import {
  getAllQuickCommandTags,
  getQuickCommandTagById,
  addQuickCommandTag,
  updateQuickCommandTag,
  deleteQuickCommandTag,
  setCommandTags,
  getTagsForCommand,
} from './quick-command-tag.service';

describe('Quick Command Tag Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const mockTag = {
    id: 1,
    name: 'DevOps',
    created_at: 1000,
    updated_at: 1000,
  };

  describe('getAllQuickCommandTags', () => {
    it('应返回所有快捷指令标签', async () => {
      (QuickCommandTagRepository.findAllQuickCommandTags as any).mockResolvedValueOnce([mockTag]);

      const result = await getAllQuickCommandTags();

      expect(result).toEqual([mockTag]);
      expect(QuickCommandTagRepository.findAllQuickCommandTags).toHaveBeenCalled();
    });
  });

  describe('getQuickCommandTagById', () => {
    it('应返回指定 ID 的标签', async () => {
      (QuickCommandTagRepository.findQuickCommandTagById as any).mockResolvedValueOnce(mockTag);

      const result = await getQuickCommandTagById(1);

      expect(result).toEqual(mockTag);
      expect(QuickCommandTagRepository.findQuickCommandTagById).toHaveBeenCalledWith(1);
    });

    it('标签不存在时应返回 null', async () => {
      (QuickCommandTagRepository.findQuickCommandTagById as any).mockResolvedValueOnce(null);

      const result = await getQuickCommandTagById(999);

      expect(result).toBeNull();
    });
  });

  describe('addQuickCommandTag', () => {
    it('应成功添加标签', async () => {
      (QuickCommandTagRepository.createQuickCommandTag as any).mockResolvedValueOnce(5);

      const result = await addQuickCommandTag('NewTag');

      expect(result).toBe(5);
      expect(QuickCommandTagRepository.createQuickCommandTag).toHaveBeenCalledWith('NewTag');
    });

    it('应对名称进行 trim 处理', async () => {
      (QuickCommandTagRepository.createQuickCommandTag as any).mockResolvedValueOnce(6);

      await addQuickCommandTag('  TagWithSpaces  ');

      expect(QuickCommandTagRepository.createQuickCommandTag).toHaveBeenCalledWith('TagWithSpaces');
    });

    it('空名称应抛出异常', async () => {
      await expect(addQuickCommandTag('')).rejects.toThrow('标签名称不能为空');
    });

    it('仅空白字符的名称应抛出异常', async () => {
      await expect(addQuickCommandTag('   ')).rejects.toThrow('标签名称不能为空');
    });

    it('repository 错误应向上传递', async () => {
      (QuickCommandTagRepository.createQuickCommandTag as any).mockRejectedValueOnce(
        new Error('快捷指令标签名称 "Dup" 已存在。')
      );

      await expect(addQuickCommandTag('Dup')).rejects.toThrow('快捷指令标签名称 "Dup" 已存在。');
    });
  });

  describe('updateQuickCommandTag', () => {
    it('应成功更新标签', async () => {
      (QuickCommandTagRepository.updateQuickCommandTag as any).mockResolvedValueOnce(true);

      const result = await updateQuickCommandTag(1, 'UpdatedName');

      expect(result).toBe(true);
      expect(QuickCommandTagRepository.updateQuickCommandTag).toHaveBeenCalledWith(
        1,
        'UpdatedName'
      );
    });

    it('应对名称进行 trim 处理', async () => {
      (QuickCommandTagRepository.updateQuickCommandTag as any).mockResolvedValueOnce(true);

      await updateQuickCommandTag(1, '  Trimmed  ');

      expect(QuickCommandTagRepository.updateQuickCommandTag).toHaveBeenCalledWith(1, 'Trimmed');
    });

    it('空名称应抛出异常', async () => {
      await expect(updateQuickCommandTag(1, '')).rejects.toThrow('标签名称不能为空');
    });

    it('标签不存在时应返回 false', async () => {
      (QuickCommandTagRepository.updateQuickCommandTag as any).mockResolvedValueOnce(false);

      const result = await updateQuickCommandTag(999, 'Test');

      expect(result).toBe(false);
    });

    it('repository 错误应向上传递', async () => {
      (QuickCommandTagRepository.updateQuickCommandTag as any).mockRejectedValueOnce(
        new Error('更新快捷指令标签失败')
      );

      await expect(updateQuickCommandTag(1, 'Test')).rejects.toThrow('更新快捷指令标签失败');
    });
  });

  describe('deleteQuickCommandTag', () => {
    it('应成功删除标签', async () => {
      (QuickCommandTagRepository.deleteQuickCommandTag as any).mockResolvedValueOnce(true);

      const result = await deleteQuickCommandTag(1);

      expect(result).toBe(true);
      expect(QuickCommandTagRepository.deleteQuickCommandTag).toHaveBeenCalledWith(1);
    });

    it('标签不存在时应返回 false', async () => {
      (QuickCommandTagRepository.deleteQuickCommandTag as any).mockResolvedValueOnce(false);

      const result = await deleteQuickCommandTag(999);

      expect(result).toBe(false);
    });

    it('repository 错误应向上传递', async () => {
      (QuickCommandTagRepository.deleteQuickCommandTag as any).mockRejectedValueOnce(
        new Error('删除快捷指令标签失败')
      );

      await expect(deleteQuickCommandTag(1)).rejects.toThrow('删除快捷指令标签失败');
    });
  });

  describe('setCommandTags', () => {
    it('应成功设置指令的标签关联', async () => {
      (QuickCommandTagRepository.setCommandTagAssociations as any).mockResolvedValueOnce(undefined);

      await expect(setCommandTags(1, [1, 2, 3])).resolves.toBeUndefined();

      expect(QuickCommandTagRepository.setCommandTagAssociations).toHaveBeenCalledWith(
        1,
        [1, 2, 3]
      );
    });

    it('空标签列表应清除所有关联', async () => {
      (QuickCommandTagRepository.setCommandTagAssociations as any).mockResolvedValueOnce(undefined);

      await setCommandTags(1, []);

      expect(QuickCommandTagRepository.setCommandTagAssociations).toHaveBeenCalledWith(1, []);
    });

    it('非数组的 tagIds 应抛出异常', async () => {
      await expect(setCommandTags(1, 'not array' as any)).rejects.toThrow(
        '标签 ID 列表必须是一个数字数组'
      );
    });

    it('包含非数字的 tagIds 应抛出异常', async () => {
      await expect(setCommandTags(1, [1, 'two', 3] as any)).rejects.toThrow(
        '标签 ID 列表必须是一个数字数组'
      );
    });

    it('repository 错误应向上传递', async () => {
      (QuickCommandTagRepository.setCommandTagAssociations as any).mockRejectedValueOnce(
        new Error('无法设置快捷指令标签关联')
      );

      await expect(setCommandTags(1, [1, 2])).rejects.toThrow('无法设置快捷指令标签关联');
    });
  });

  describe('getTagsForCommand', () => {
    it('应返回指定指令的所有标签', async () => {
      (QuickCommandTagRepository.findTagsByCommandId as any).mockResolvedValueOnce([mockTag]);

      const result = await getTagsForCommand(1);

      expect(result).toEqual([mockTag]);
      expect(QuickCommandTagRepository.findTagsByCommandId).toHaveBeenCalledWith(1);
    });

    it('指令无标签时应返回空数组', async () => {
      (QuickCommandTagRepository.findTagsByCommandId as any).mockResolvedValueOnce([]);

      const result = await getTagsForCommand(999);

      expect(result).toHaveLength(0);
    });

    it('repository 错误应向上传递', async () => {
      (QuickCommandTagRepository.findTagsByCommandId as any).mockRejectedValueOnce(
        new Error('获取快捷指令标签失败')
      );

      await expect(getTagsForCommand(1)).rejects.toThrow('获取快捷指令标签失败');
    });
  });
});
