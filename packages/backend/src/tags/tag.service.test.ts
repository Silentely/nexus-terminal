/**
 * Tag Service 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as TagRepository from './tag.repository';
import {
  getAllTags,
  getTagById,
  createTag,
  updateTag,
  deleteTag,
  updateTagConnections,
} from './tag.service';

// Mock Tag Repository
vi.mock('./tag.repository', () => ({
  findAllTags: vi.fn(),
  findTagById: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  updateTagConnections: vi.fn(),
}));

describe('Tag Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe('getAllTags', () => {
    it('应返回所有标签', async () => {
      const mockTags = [
        { id: 1, name: 'Production', created_at: 1000, updated_at: 1000 },
        { id: 2, name: 'Development', created_at: 1001, updated_at: 1001 },
      ];
      (TagRepository.findAllTags as any).mockResolvedValueOnce(mockTags);

      const result = await getAllTags();

      expect(result).toEqual(mockTags);
      expect(TagRepository.findAllTags).toHaveBeenCalled();
    });
  });

  describe('getTagById', () => {
    it('应返回指定 ID 的标签', async () => {
      const mockTag = { id: 1, name: 'Production', created_at: 1000, updated_at: 1000 };
      (TagRepository.findTagById as any).mockResolvedValueOnce(mockTag);

      const result = await getTagById(1);

      expect(result).toEqual(mockTag);
      expect(TagRepository.findTagById).toHaveBeenCalledWith(1);
    });

    it('标签不存在时应返回 null', async () => {
      (TagRepository.findTagById as any).mockResolvedValueOnce(null);

      const result = await getTagById(999);

      expect(result).toBeNull();
    });
  });

  describe('createTag', () => {
    it('应成功创建标签并返回完整标签数据', async () => {
      const newTag = { id: 5, name: 'New Tag', created_at: 1000, updated_at: 1000 };
      (TagRepository.createTag as any).mockResolvedValueOnce(5);
      (TagRepository.findTagById as any).mockResolvedValueOnce(newTag);

      const result = await createTag('  New Tag  '); // 带空格

      expect(result).toEqual(newTag);
      expect(TagRepository.createTag).toHaveBeenCalledWith('New Tag'); // 已 trim
    });

    it('空标签名称应抛出异常', async () => {
      await expect(createTag('')).rejects.toThrow('标签名称不能为空');
      await expect(createTag('   ')).rejects.toThrow('标签名称不能为空');
    });

    it('创建后无法检索到标签应抛出异常', async () => {
      (TagRepository.createTag as any).mockResolvedValueOnce(5);
      (TagRepository.findTagById as any).mockResolvedValueOnce(null);

      await expect(createTag('Test')).rejects.toThrow('创建标签后无法检索到该标签');
    });

    it('标签名称重复时应抛出异常', async () => {
      (TagRepository.createTag as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(createTag('Duplicate')).rejects.toThrow('标签名称 "Duplicate" 已存在');
    });

    it('其他错误应向上传递', async () => {
      (TagRepository.createTag as any).mockRejectedValueOnce(new Error('Unknown error'));

      await expect(createTag('Test')).rejects.toThrow('Unknown error');
    });
  });

  describe('updateTag', () => {
    it('应成功更新标签并返回更新后的数据', async () => {
      const updatedTag = { id: 1, name: 'Updated Name', created_at: 1000, updated_at: 2000 };
      (TagRepository.updateTag as any).mockResolvedValueOnce(true);
      (TagRepository.findTagById as any).mockResolvedValueOnce(updatedTag);

      const result = await updateTag(1, '  Updated Name  ');

      expect(result).toEqual(updatedTag);
      expect(TagRepository.updateTag).toHaveBeenCalledWith(1, 'Updated Name');
    });

    it('空标签名称应抛出异常', async () => {
      await expect(updateTag(1, '')).rejects.toThrow('标签名称不能为空');
      await expect(updateTag(1, '   ')).rejects.toThrow('标签名称不能为空');
    });

    it('标签不存在时应返回 null', async () => {
      (TagRepository.updateTag as any).mockResolvedValueOnce(false);

      const result = await updateTag(999, 'Test');

      expect(result).toBeNull();
    });

    it('标签名称重复时应抛出异常', async () => {
      (TagRepository.updateTag as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(updateTag(1, 'Duplicate')).rejects.toThrow('标签名称 "Duplicate" 已存在');
    });
  });

  describe('deleteTag', () => {
    it('应成功删除标签', async () => {
      (TagRepository.deleteTag as any).mockResolvedValueOnce(true);

      const result = await deleteTag(1);

      expect(result).toBe(true);
      expect(TagRepository.deleteTag).toHaveBeenCalledWith(1);
    });

    it('标签不存在时应返回 false', async () => {
      (TagRepository.deleteTag as any).mockResolvedValueOnce(false);

      const result = await deleteTag(999);

      expect(result).toBe(false);
    });
  });

  describe('updateTagConnections', () => {
    it('应成功更新标签关联的连接', async () => {
      (TagRepository.updateTagConnections as any).mockResolvedValueOnce(undefined);

      await expect(updateTagConnections(1, [10, 20])).resolves.toBeUndefined();

      expect(TagRepository.updateTagConnections).toHaveBeenCalledWith(1, [10, 20]);
    });

    it('应正确处理非数组输入', async () => {
      (TagRepository.updateTagConnections as any).mockResolvedValueOnce(undefined);

      // 传入 null 或 undefined 应转换为空数组
      await expect(updateTagConnections(1, null as any)).resolves.toBeUndefined();

      expect(TagRepository.updateTagConnections).toHaveBeenCalledWith(1, []);
    });

    it('repository 错误应向上传递', async () => {
      (TagRepository.updateTagConnections as any).mockRejectedValueOnce(
        new Error('Repository error')
      );

      await expect(updateTagConnections(1, [10])).rejects.toThrow('服务层更新标签连接关联失败');
    });
  });
});
