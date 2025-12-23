import { Request, Response } from 'express';
import * as TagService from './tag.service';
import { AuditLogService } from '../audit/audit.service';

const auditLogService = new AuditLogService();

/**
 * 创建新标签 (POST /api/v1/tags)
 */
export const createTag = async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ message: '标签名称不能为空。' });
    return;
  }

  try {
    const newTag = await TagService.createTag(name);
    // 记录审计日志
    auditLogService.logAction('TAG_CREATED', { tagId: newTag.id, name: newTag.name });
    res.status(201).json({ message: '标签创建成功。', tag: newTag });
  } catch (error: any) {
    console.error('Controller: 创建标签时发生错误:', error);
    if (error.message.includes('已存在')) {
      res.status(409).json({ message: error.message });
    } else {
      res.status(500).json({ message: error.message || '创建标签时发生内部服务器错误。' });
    }
  }
};

/**
 * 获取标签列表 (GET /api/v1/tags)
 */
export const getTags = async (req: Request, res: Response): Promise<void> => {
  try {
    const tags = await TagService.getAllTags();
    res.status(200).json(tags);
  } catch (error: any) {
    console.error('Controller: 获取标签列表时发生错误:', error);
    res.status(500).json({ message: error.message || '获取标签列表时发生内部服务器错误。' });
  }
};

/**
 * 获取单个标签信息 (GET /api/v1/tags/:id)
 */
export const getTagById = async (req: Request, res: Response): Promise<void> => {
  const tagId = parseInt(req.params.id, 10);

  if (isNaN(tagId)) {
    res.status(400).json({ message: '无效的标签 ID。' });
    return;
  }

  try {
    const tag = await TagService.getTagById(tagId);
    if (!tag) {
      res.status(404).json({ message: '标签未找到。' });
    } else {
      res.status(200).json(tag);
    }
  } catch (error: any) {
    console.error(`Controller: 获取标签 ${tagId} 时发生错误:`, error);
    res.status(500).json({ message: error.message || '获取标签信息时发生内部服务器错误。' });
  }
};

/**
 * 更新标签信息 (PUT /api/v1/tags/:id)
 */
export const updateTag = async (req: Request, res: Response): Promise<void> => {
  const tagId = parseInt(req.params.id, 10);
  const { name } = req.body;

  if (isNaN(tagId)) {
    res.status(400).json({ message: '无效的标签 ID。' });
    return;
  }
  if (!name || typeof name !== 'string' || name.trim() === '') {
    res.status(400).json({ message: '标签名称不能为空。' });
    return;
  }

  try {
    const updatedTag = await TagService.updateTag(tagId, name);
    if (!updatedTag) {
      res.status(404).json({ message: '标签未找到。' });
    } else {
      // 记录审计日志
      auditLogService.logAction('TAG_UPDATED', { tagId, newName: name });
      res.status(200).json({ message: '标签更新成功。', tag: updatedTag });
    }
  } catch (error: any) {
    console.error(`Controller: 更新标签 ${tagId} 时发生错误:`, error);
    if (error.message.includes('已存在')) {
      res.status(409).json({ message: error.message });
    } else if (error.message.includes('不能为空')) {
      res.status(400).json({ message: error.message });
    } else {
      res.status(500).json({ message: error.message || '更新标签时发生内部服务器错误。' });
    }
  }
};

/**
 * 删除标签 (DELETE /api/v1/tags/:id)
 */
export const deleteTag = async (req: Request, res: Response): Promise<void> => {
  const tagId = parseInt(req.params.id, 10);

  if (isNaN(tagId)) {
    res.status(400).json({ message: '无效的标签 ID。' });
    return;
  }

  try {
    const deleted = await TagService.deleteTag(tagId);
    if (!deleted) {
      res.status(404).json({ message: '标签未找到。' });
    } else {
      // 记录审计日志
      auditLogService.logAction('TAG_DELETED', { tagId });
      res.status(200).json({ message: '标签删除成功。' });
    }
  } catch (error: any) {
    console.error(`Controller: 删除标签 ${tagId} 时发生错误:`, error);
    res.status(500).json({ message: error.message || '删除标签时发生内部服务器错误。' });
  }
};

/**
 * 更新标签与连接的关联关系 (PUT /api/v1/tags/:id/connections)
 */
export const updateTagConnections = async (req: Request, res: Response): Promise<void> => {
  const tagId = parseInt(req.params.id, 10);
  const { connection_ids } = req.body; // 前端发送的是 connection_ids

  if (isNaN(tagId)) {
    res.status(400).json({ message: '无效的标签 ID。' });
    return;
  }

  if (!Array.isArray(connection_ids)) {
    res.status(400).json({ message: 'connection_ids 必须是一个数组。' });
    return;
  }

  // 可选：验证 connection_ids 中的每个 ID 是否为数字
  if (!connection_ids.every((id) => typeof id === 'number')) {
    res.status(400).json({ message: 'connection_ids 数组中的所有元素必须是数字。' });
    return;
  }

  try {
    await TagService.updateTagConnections(tagId, connection_ids);
    res.status(200).json({ message: '标签的连接关联更新成功。' });
  } catch (error: any) {
    console.error(`Controller: 更新标签 ${tagId} 的连接关联时发生错误:`, error);
    // 可以根据 TagService 抛出的错误类型来返回更具体的错误码和消息
    if (error.message.includes('标签未找到')) {
      // 假设服务层或仓库层会检查标签是否存在
      res.status(404).json({ message: '标签未找到。' });
    } else {
      res.status(500).json({ message: error.message || '更新标签连接关联时发生内部服务器错误。' });
    }
  }
};
