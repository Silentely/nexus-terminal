import { Request, Response } from 'express';
import * as PathHistoryService from '../services/path-history.service';

/**
 * 处理添加新路径历史记录的请求
 */
export const addPath = async (req: Request, res: Response): Promise<void> => {
  const { path } = req.body;

  if (!path || typeof path !== 'string' || path.trim().length === 0) {
    res.status(400).json({ message: '路径不能为空' });
    return;
  }

  try {
    const newId = await PathHistoryService.addPathHistory(path);
    res.status(201).json({ id: newId, message: '路径已添加到历史记录' });
  } catch (error: any) {
    console.error('添加路径历史记录控制器出错:', error);
    res.status(500).json({ message: error.message || '无法添加路径历史记录' });
  }
};

/**
 * 处理获取所有路径历史记录的请求
 */
export const getAllPaths = async (req: Request, res: Response): Promise<void> => {
  try {
    const history = await PathHistoryService.getAllPathHistory();
    // Repository 返回的是升序（旧->新）
    res.status(200).json(history);
  } catch (error: any) {
    console.error('获取路径历史记录控制器出错:', error);
    res.status(500).json({ message: error.message || '无法获取路径历史记录' });
  }
};

/**
 * 处理根据 ID 删除路径历史记录的请求
 */
export const deletePath = async (req: Request, res: Response): Promise<void> => {
  const id = parseInt(req.params.id, 10);

  if (isNaN(id)) {
    res.status(400).json({ message: '无效的 ID' });
    return;
  }

  try {
    const success = await PathHistoryService.deletePathHistoryById(id);
    if (success) {
      res.status(200).json({ message: '路径历史记录已删除' });
    } else {
      res.status(404).json({ message: '未找到要删除的路径历史记录' });
    }
  } catch (error: any) {
    console.error('删除路径历史记录控制器出错:', error);
    res.status(500).json({ message: error.message || '无法删除路径历史记录' });
  }
};

/**
 * 处理清空所有路径历史记录的请求
 */
export const clearAllPaths = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await PathHistoryService.clearAllPathHistory();
    res.status(200).json({ count, message: `已清空 ${count} 条路径历史记录` });
  } catch (error: any) {
    console.error('清空路径历史记录控制器出错:', error);
    res.status(500).json({ message: error.message || '无法清空路径历史记录' });
  }
};
