import { Request, Response, NextFunction } from 'express';
import * as QuickCommandTagService from './quick-command-tag.service';
import { ErrorFactory } from '../utils/AppError';

/**
 * 处理获取所有快捷指令标签的请求
 */
export const getAllQuickCommandTags = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const tags = await QuickCommandTagService.getAllQuickCommandTags();
    res.status(200).json(tags);
  } catch (error) {
    console.error('[Controller] 获取快捷指令标签列表失败:', error);
    next(error);
  }
};

/**
 * 处理添加新快捷指令标签的请求
 */
export const addQuickCommandTag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ message: '标签名称不能为空且必须是字符串' });
    return;
  }

  try {
    const newId = await QuickCommandTagService.addQuickCommandTag(name);
    // 成功添加后，获取新创建的标签信息返回给前端
    const newTag = await QuickCommandTagService.getQuickCommandTagById(newId);
    if (newTag) {
      res.status(201).json({ message: '快捷指令标签已添加', tag: newTag });
    } else {
      // 理论上不应该发生，但作为健壮性检查
      console.error(`[Controller] 添加快捷指令标签后未能找到 ID: ${newId}`);
      res.status(201).json({ message: '快捷指令标签已添加，但无法检索新记录', id: newId });
    }
  } catch (error) {
    console.error('[Controller] 添加快捷指令标签失败:', error);
    next(error);
  }
};

/**
 * 处理更新快捷指令标签的请求
 */
export const updateQuickCommandTag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  const { name } = req.body;

  if (isNaN(id)) {
    res.status(400).json({ message: '无效的标签 ID' });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ message: '标签名称不能为空且必须是字符串' });
    return;
  }

  try {
    const success = await QuickCommandTagService.updateQuickCommandTag(id, name);
    if (success) {
      // 成功更新后，获取更新后的标签信息返回给前端
      const updatedTag = await QuickCommandTagService.getQuickCommandTagById(id);
      if (updatedTag) {
        res.status(200).json({ message: '快捷指令标签已更新', tag: updatedTag });
      } else {
        console.error(`[Controller] 更新快捷指令标签后未能找到 ID: ${id}`);
        res.status(200).json({ message: '快捷指令标签已更新，但无法检索更新后的记录' });
      }
    } else {
      // 检查标签是否真的不存在
      const tagExists = await QuickCommandTagService.getQuickCommandTagById(id);
      if (!tagExists) {
        res.status(404).json({ message: '未找到要更新的快捷指令标签' });
      } else {
        // 如果标签存在但更新失败（理论上不太可能，除非并发问题），返回服务器错误
        console.error(`[Controller] 更新快捷指令标签 ${id} 失败，但标签存在。`);
        next(ErrorFactory.internalError('更新快捷指令标签时发生未知错误'));
        return;
      }
    }
  } catch (error) {
    console.error('[Controller] 更新快捷指令标签失败:', error);
    next(error);
  }
};

/**
 * 处理删除快捷指令标签的请求
 */
export const deleteQuickCommandTag = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ message: '无效的标签 ID' });
    return;
  }

  try {
    // 先检查标签是否存在，以便返回 404
    const tagExists = await QuickCommandTagService.getQuickCommandTagById(id);
    if (!tagExists) {
      res.status(404).json({ message: '未找到要删除的快捷指令标签' });
      return;
    }

    const success = await QuickCommandTagService.deleteQuickCommandTag(id);
    if (success) {
      res.status(200).json({ message: '快捷指令标签已删除' });
    } else {
      // 如果上面检查存在但删除失败，说明有内部错误
      console.error(`[Controller] 删除快捷指令标签 ${id} 失败，但标签存在。`);
      next(ErrorFactory.internalError('删除快捷指令标签时发生未知错误'));
      return;
    }
  } catch (error) {
    console.error('[Controller] 删除快捷指令标签失败:', error);
    next(error);
  }
};
