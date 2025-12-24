import * as QuickCommandsRepository from './quick-commands.repository';
import { QuickCommandWithTags } from './quick-commands.repository';
import * as QuickCommandTagRepository from '../quick-command-tags/quick-command-tag.repository';

// 定义排序类型
export type QuickCommandSortBy = 'name' | 'usage_count';

/**
 * 添加快捷指令
 * @param name - 指令名称 (可选)
 * @param command - 指令内容
 * @param tagIds - 关联的快捷指令标签 ID 数组 (可选)
 * @param variables - 变量对象 (可选)
 * @returns 返回添加记录的 ID
 */
export const addQuickCommand = async (
  name: string | null,
  command: string,
  tagIds?: number[],
  variables?: Record<string, string>
): Promise<number> => {
  if (!command || command.trim().length === 0) {
    throw new Error('指令内容不能为空');
  }
  // 如果 name 是空字符串，则视为 null
  const finalName = name && name.trim().length > 0 ? name.trim() : null;
  const commandId = await QuickCommandsRepository.addQuickCommand(
    finalName,
    command.trim(),
    variables
  );

  // 添加成功后，设置标签关联
  if (commandId > 0 && tagIds && Array.isArray(tagIds)) {
    try {
      await QuickCommandTagRepository.setCommandTagAssociations(commandId, tagIds);
    } catch (tagError: any) {
      // 如果标签关联失败，可以选择记录警告或回滚（但通常不回滚主记录）
      console.warn(
        `[Service] 添加快捷指令 ${commandId} 成功，但设置标签关联失败:`,
        tagError.message
      );
      // 可以考虑是否需要通知用户部分操作失败
    }
  }
  return commandId;
};

/**
 * 更新快捷指令
 * @param id - 要更新的记录 ID
 * @param name - 新的指令名称 (可选)
 * @param command - 新的指令内容
 * @param tagIds - 新的关联标签 ID 数组 (可选, undefined 表示不更新标签)
 * @param variables - 新的变量对象 (可选)
 * @returns 返回是否成功更新 (更新行数 > 0)
 */
export const updateQuickCommand = async (
  id: number,
  name: string | null,
  command: string,
  tagIds?: number[],
  variables?: Record<string, string>
): Promise<boolean> => {
  if (!command || command.trim().length === 0) {
    throw new Error('指令内容不能为空');
  }
  const finalName = name && name.trim().length > 0 ? name.trim() : null;
  const commandUpdated = await QuickCommandsRepository.updateQuickCommand(
    id,
    finalName,
    command.trim(),
    variables
  );

  // 如果指令更新成功，并且提供了 tagIds (即使是空数组也表示要更新)，则更新标签关联
  if (commandUpdated && typeof tagIds !== 'undefined') {
    try {
      await QuickCommandTagRepository.setCommandTagAssociations(id, tagIds);
    } catch (tagError: any) {
      console.warn(`[Service] 更新快捷指令 ${id} 成功，但更新标签关联失败:`, tagError.message);
      // 即使标签更新失败，主记录已更新，通常返回 true
    }
  }
  // 返回主记录是否更新成功
  return commandUpdated;
};

/**
 * 删除快捷指令
 * @param id - 要删除的记录 ID
 * @returns 返回是否成功删除 (删除行数 > 0)
 */
export const deleteQuickCommand = async (id: number): Promise<boolean> => {
  const changes = await QuickCommandsRepository.deleteQuickCommand(id);
  return changes;
};

/**
 * 获取所有快捷指令，并按指定方式排序
 * @param sortBy - 排序字段 ('name' 或 'usage_count')
 * @returns 返回排序后的快捷指令数组 (包含 tagIds)
 */
export const getAllQuickCommands = async (
  sortBy: QuickCommandSortBy = 'name'
): Promise<QuickCommandWithTags[]> => {
  // Repository 已返回带 tagIds 的数据
  return QuickCommandsRepository.getAllQuickCommands(sortBy);
};

/**
 * 增加快捷指令的使用次数
 * @param id - 记录 ID
 * @returns 返回是否成功更新 (更新行数 > 0)
 */
export const incrementUsageCount = async (id: number): Promise<boolean> => {
  const changes = await QuickCommandsRepository.incrementUsageCount(id);
  return changes;
};

/**
 * 根据 ID 获取单个快捷指令 (可能用于编辑)
 * @param id - 记录 ID
 * @returns 返回找到的快捷指令 (包含 tagIds)，或 undefined
 */
export const getQuickCommandById = async (
  id: number
): Promise<QuickCommandWithTags | undefined> => {
  // Repository 已返回带 tagIds 的数据
  return QuickCommandsRepository.findQuickCommandById(id);
};

/**
 * 将单个标签批量关联到多个快捷指令
 * @param commandIds - 需要添加标签的快捷指令 ID 数组
 * @param tagId - 要添加的标签 ID
 * @returns Promise<void>
 */
export const assignTagToCommands = async (commandIds: number[], tagId: number): Promise<void> => {
  try {
    // 基本验证
    if (
      !Array.isArray(commandIds) ||
      commandIds.some((id) => typeof id !== 'number' || Number.isNaN(id))
    ) {
      throw new Error('无效的指令 ID 列表');
    }
    if (typeof tagId !== 'number' || Number.isNaN(tagId)) {
      throw new Error('无效的标签 ID');
    }

    // 调用 Repository 函数执行批量关联
    // 注意：这里需要导入 QuickCommandTagRepository
    console.log(
      `[Service] assignTagToCommands: Calling repo with commandIds: ${JSON.stringify(commandIds)}, tagId: ${tagId}`
    );
    await QuickCommandTagRepository.addTagToCommands(commandIds, tagId);
    console.log(`[Service] assignTagToCommands: Repo call finished for tag ${tagId}.`); // +++ 修改日志 +++
    // 可以在这里添加额外的业务逻辑，例如发送事件通知等
  } catch (error: any) {
    console.error(
      `[Service] assignTagToCommands: 批量关联标签 ${tagId} 到指令时出错:`,
      error.message
    );
    // 向上抛出错误，让 Controller 处理 HTTP 响应
    throw error;
  }
};
