import * as TagRepository from './tag.repository';
import { getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';
import eventService, { AppEventType } from '../services/event.service';

// Re-export or define types
export interface TagData extends TagRepository.TagData {}

/**
 * 获取所有标签
 */
export const getAllTags = async (): Promise<TagData[]> => {
  return TagRepository.findAllTags();
};

/**
 * 根据 ID 获取单个标签
 */
export const getTagById = async (id: number): Promise<TagData | null> => {
  return TagRepository.findTagById(id);
};

/**
 * 创建新标签
 */
export const createTag = async (name: string): Promise<TagData> => {
  if (!name || name.trim().length === 0) {
    throw new Error('标签名称不能为空。');
  }
  const trimmedName = name.trim();

  try {
    const newTagId = await TagRepository.createTag(trimmedName);
    const newTag = await getTagById(newTagId);
    if (!newTag) {
      throw new Error('创建标签后无法检索到该标签。');
    }

    eventService.emitEvent(AppEventType.TagCreated, {
      details: { tagId: newTag.id, name: newTag.name },
    });

    return newTag;
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    if (errMsg.includes('UNIQUE constraint failed')) {
      throw new Error(`创建标签失败：标签名称 "${trimmedName}" 已存在。`);
    }
    throw error;
  }
};

/**
 * 更新标签名称
 */
export const updateTag = async (id: number, name: string): Promise<TagData | null> => {
  if (!name || name.trim().length === 0) {
    throw new Error('标签名称不能为空。');
  }
  const trimmedName = name.trim();

  try {
    const updated = await TagRepository.updateTag(id, trimmedName);
    if (!updated) {
      return null;
    }

    eventService.emitEvent(AppEventType.TagUpdated, {
      details: { tagId: id, name: trimmedName },
    });

    return getTagById(id);
  } catch (error: unknown) {
    const errMsg = getErrorMessage(error);
    if (errMsg.includes('UNIQUE constraint failed')) {
      throw new Error(`更新标签失败：标签名称 "${trimmedName}" 已存在。`);
    }
    throw error;
  }
};

/**
 * 删除标签
 */
export const deleteTag = async (id: number): Promise<boolean> => {
  const result = await TagRepository.deleteTag(id);
  if (result) {
    eventService.emitEvent(AppEventType.TagDeleted, {
      details: { tagId: id },
    });
  }
  return result;
};

/**
 * 更新标签与连接的关联关系
 */
export const updateTagConnections = async (
  tagId: number,
  connectionIds: number[],
): Promise<void> => {
  // 在服务层可以添加额外的业务逻辑，例如验证 tagId 和 connectionIds 的有效性
  // 例如，检查标签是否存在，连接 ID 是否都存在于数据库中等。
  // 此处为简化，直接调用 repository 方法。

  // 确保 connectionIds 是一个数组，即使是空数组
  const idsToUpdate = Array.isArray(connectionIds) ? connectionIds : [];

  try {
    await TagRepository.updateTagConnections(tagId, idsToUpdate);
  } catch (error: unknown) {
    // 服务层可以进一步处理或包装错误
    const errMsg = getErrorMessage(error);
    logger.error(`Service: 更新标签 ${tagId} 的连接关联时发生错误:`, errMsg);
    throw new Error(`服务层更新标签连接关联失败: ${errMsg}`);
  }
};
