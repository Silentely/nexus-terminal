import { Request, Response, NextFunction } from 'express';
import * as QuickCommandsService from './quick-commands.service';
import { QuickCommandSortBy } from './quick-commands.service';
import { ErrorFactory } from '../utils/AppError';

/**
 * 处理添加新快捷指令的请求
 */
export const addQuickCommand = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // 从请求体中解构出 name, command, 以及可选的 tagIds 和 variables
  const { name, command, tagIds, variables } = req.body;

  // --- 基本验证 ---
  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    res.status(400).json({ message: '指令内容不能为空' });
    return;
  }
  // 名称可以是 null 或 string
  if (name !== null && typeof name !== 'string') {
    res.status(400).json({ message: '名称必须是字符串或 null' });
    return;
  }
  // 验证 tagIds (如果提供的话)
  if (
    tagIds !== undefined &&
    (!Array.isArray(tagIds) || !tagIds.every((id) => typeof id === 'number'))
  ) {
    res.status(400).json({ message: 'tagIds 必须是一个数字数组' });
    return;
  }
  // 验证 variables (如果提供的话)
  if (
    variables !== undefined &&
    (typeof variables !== 'object' || variables === null || Array.isArray(variables))
  ) {
    res.status(400).json({ message: 'variables 必须是一个对象' });
    return;
  }

  try {
    // 将 tagIds 和 variables 传递给 Service 层
    const newId = await QuickCommandsService.addQuickCommand(name, command, tagIds, variables);
    // 尝试获取新创建的带标签的指令信息返回
    const newCommand = await QuickCommandsService.getQuickCommandById(newId);
    if (newCommand) {
      res.status(201).json({ message: '快捷指令已添加', command: newCommand });
    } else {
      console.error(`[Controller] 添加快捷指令后未能找到 ID: ${newId}`);
      res.status(201).json({ message: '快捷指令已添加，但无法检索新记录', id: newId });
    }
  } catch (error) {
    console.error('[Controller] 添加快捷指令失败:', error);
    next(error);
  }
};

/**
 * 处理获取所有快捷指令的请求 (支持排序)
 */
export const getAllQuickCommands = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const sortBy = req.query.sortBy as QuickCommandSortBy | undefined;
  // 验证 sortBy 参数
  const validSortBy: QuickCommandSortBy =
    sortBy === 'name' || sortBy === 'usage_count' ? sortBy : 'name';

  try {
    const commands = await QuickCommandsService.getAllQuickCommands(validSortBy);
    res.status(200).json(commands);
  } catch (error) {
    console.error('获取快捷指令控制器出错:', error);
    next(error);
  }
};

/**
 * 处理更新快捷指令的请求
 */
export const updateQuickCommand = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  // 从请求体中解构出 name, command, 以及可选的 tagIds 和 variables
  const { name, command, tagIds, variables } = req.body;

  // --- 基本验证 ---
  if (Number.isNaN(id)) {
    res.status(400).json({ message: '无效的 ID' });
    return;
  }
  if (!command || typeof command !== 'string' || command.trim().length === 0) {
    res.status(400).json({ message: '指令内容不能为空' });
    return;
  }
  if (name !== null && typeof name !== 'string') {
    res.status(400).json({ message: '名称必须是字符串或 null' });
    return;
  }
  // 验证 tagIds (如果提供的话)
  // 注意: tagIds 为 undefined 表示不更新标签，空数组 [] 表示清除所有标签
  if (
    tagIds !== undefined &&
    (!Array.isArray(tagIds) || !tagIds.every((id) => typeof id === 'number'))
  ) {
    res.status(400).json({ message: 'tagIds 必须是一个数字数组' });
    return;
  }
  // 验证 variables (如果提供的话)
  // undefined 表示不更新 variables, null 或对象表示要更新
  if (
    variables !== undefined &&
    variables !== null &&
    (typeof variables !== 'object' || Array.isArray(variables))
  ) {
    res.status(400).json({ message: 'variables 必须是对象或 null' });
    return;
  }

  try {
    // 将 tagIds 和 variables 传递给 Service 层
    const success = await QuickCommandsService.updateQuickCommand(
      id,
      name,
      command,
      tagIds,
      variables
    );
    if (success) {
      // 尝试获取更新后的带标签的指令信息返回
      const updatedCommand = await QuickCommandsService.getQuickCommandById(id);
      if (updatedCommand) {
        res.status(200).json({ message: '快捷指令已更新', command: updatedCommand });
      } else {
        console.error(`[Controller] 更新快捷指令后未能找到 ID: ${id}`);
        res.status(200).json({ message: '快捷指令已更新，但无法检索更新后的记录' });
      }
    } else {
      // 检查指令是否真的不存在
      const commandExists = await QuickCommandsService.getQuickCommandById(id);
      if (!commandExists) {
        res.status(404).json({ message: '未找到要更新的快捷指令' });
      } else {
        console.error(`[Controller] 更新快捷指令 ${id} 失败，但指令存在。`);
        next(ErrorFactory.internalError('更新快捷指令时发生未知错误'));
        return;
      }
    }
  } catch (error) {
    console.error('更新快捷指令控制器出错:', error);
    next(error);
  }
};

/**
 * 处理删除快捷指令的请求
 */
export const deleteQuickCommand = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    res.status(400).json({ message: '无效的 ID' });
    return;
  }

  try {
    const success = await QuickCommandsService.deleteQuickCommand(id);
    if (success) {
      res.status(200).json({ message: '快捷指令已删除' });
    } else {
      res.status(404).json({ message: '未找到要删除的快捷指令' });
    }
  } catch (error) {
    console.error('删除快捷指令控制器出错:', error);
    next(error);
  }
};

/**
 * 处理增加快捷指令使用次数的请求
 */
export const incrementUsage = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  if (Number.isNaN(id)) {
    res.status(400).json({ message: '无效的 ID' });
    return;
  }

  try {
    const success = await QuickCommandsService.incrementUsageCount(id);
    if (success) {
      res.status(200).json({ message: '使用次数已增加' });
    } else {
      // 即使没找到也可能返回成功，避免不必要的错误提示
      console.warn(`尝试增加不存在的快捷指令 (ID: ${id}) 的使用次数`);
      res.status(200).json({ message: '使用次数已记录 (或指令不存在)' });
    }
  } catch (error) {
    console.error('增加快捷指令使用次数控制器出错:', error);
    next(error);
  }
};

/**
 * 批量将标签分配给多个快捷指令
 */
export const assignTagToCommands = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  // Add : Promise<void>
  const { commandIds, tagId } = req.body;

  // 基本验证
  if (!Array.isArray(commandIds) || commandIds.length === 0 || typeof tagId !== 'number') {
    res
      .status(400)
      .json({ success: false, message: '请求体必须包含 commandIds (非空数组) 和 tagId (数字)。' });
    return; // Use return without value to exit early
  }

  try {
    // 调用 Service 函数处理批量分配
    console.log(
      `[Controller] assignTagToCommands: Received commandIds: ${JSON.stringify(commandIds)}, tagId: ${tagId}`
    );
    await QuickCommandsService.assignTagToCommands(commandIds, tagId);
    res.status(200).json({
      success: true,
      message: `标签 ${tagId} 已成功尝试关联到 ${commandIds.length} 个指令。`,
    });
  } catch (error) {
    console.error('[Controller] 批量分配标签时出错:', error);
    next(error);
  }
};
