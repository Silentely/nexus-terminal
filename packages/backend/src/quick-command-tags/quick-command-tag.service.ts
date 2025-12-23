import * as QuickCommandTagRepository from './quick-command-tag.repository';
import { QuickCommandTag } from './quick-command-tag.repository';

/**
 * 获取所有快捷指令标签
 */
export const getAllQuickCommandTags = async (): Promise<QuickCommandTag[]> => {
  return QuickCommandTagRepository.findAllQuickCommandTags();
};

/**
 * 根据 ID 获取单个快捷指令标签
 */
export const getQuickCommandTagById = async (id: number): Promise<QuickCommandTag | null> => {
  return QuickCommandTagRepository.findQuickCommandTagById(id);
};

/**
 * 添加新的快捷指令标签
 * @param name 标签名称
 * @returns 返回新标签的 ID
 */
export const addQuickCommandTag = async (name: string): Promise<number> => {
  if (!name || name.trim().length === 0) {
    throw new Error('标签名称不能为空');
  }
  const trimmedName = name.trim();
  // 可以在这里添加更多验证逻辑，例如检查名称格式等
  try {
    const newId = await QuickCommandTagRepository.createQuickCommandTag(trimmedName);
    return newId;
  } catch (error: any) {
    // Service 层可以重新抛出或处理 Repository 抛出的错误
    console.error(`[Service] 添加快捷指令标签 "${trimmedName}" 失败:`, error.message);
    throw error; // 重新抛出，让 Controller 处理 HTTP 响应
  }
};

/**
 * 更新快捷指令标签
 * @param id 标签 ID
 * @param name 新的标签名称
 * @returns 返回是否成功更新
 */
export const updateQuickCommandTag = async (id: number, name: string): Promise<boolean> => {
  if (!name || name.trim().length === 0) {
    throw new Error('标签名称不能为空');
  }
  const trimmedName = name.trim();
  // 可以在这里添加更多验证逻辑
  try {
    const success = await QuickCommandTagRepository.updateQuickCommandTag(id, trimmedName);
    if (!success) {
      // 可能需要检查标签是否存在，或者让 Repository 处理
      console.warn(`[Service] 尝试更新不存在的快捷指令标签 ID: ${id}`);
    }
    return success;
  } catch (error: any) {
    console.error(`[Service] 更新快捷指令标签 ${id} 失败:`, error.message);
    throw error;
  }
};

/**
 * 删除快捷指令标签
 * @param id 标签 ID
 * @returns 返回是否成功删除
 */
export const deleteQuickCommandTag = async (id: number): Promise<boolean> => {
  try {
    const success = await QuickCommandTagRepository.deleteQuickCommandTag(id);
    if (!success) {
      console.warn(`[Service] 尝试删除不存在的快捷指令标签 ID: ${id}`);
    }
    return success;
  } catch (error: any) {
    console.error(`[Service] 删除快捷指令标签 ${id} 失败:`, error.message);
    throw error;
  }
};

/**
 * 设置指定快捷指令的标签关联
 * @param commandId 快捷指令 ID
 * @param tagIds 新的快捷指令标签 ID 数组
 * @returns Promise<void>
 */
export const setCommandTags = async (commandId: number, tagIds: number[]): Promise<void> => {
  // 验证 tagIds 是否为数字数组 (基本验证)
  if (!Array.isArray(tagIds) || !tagIds.every((id) => typeof id === 'number')) {
    throw new Error('标签 ID 列表必须是一个数字数组');
  }
  // 可以在这里添加更复杂的验证，例如检查 tagIds 是否都存在于 quick_command_tags 表中
  // 但 Repository 中的 setCommandTagAssociations 已包含基本的检查和错误处理

  try {
    // 直接调用 Repository 处理关联更新 (Repository 函数现在返回 void)
    await QuickCommandTagRepository.setCommandTagAssociations(commandId, tagIds);
    // Service 函数也返回 void，所以不需要 return
  } catch (error: any) {
    console.error(`[Service] 设置快捷指令 ${commandId} 的标签失败:`, error.message);
    throw error;
  }
};

/**
 * 获取指定快捷指令的所有标签
 * @param commandId 快捷指令 ID
 * @returns 标签对象数组
 */
export const getTagsForCommand = async (commandId: number): Promise<QuickCommandTag[]> => {
  try {
    return await QuickCommandTagRepository.findTagsByCommandId(commandId);
  } catch (error: any) {
    console.error(`[Service] 获取快捷指令 ${commandId} 的标签失败:`, error.message);
    throw error;
  }
};
