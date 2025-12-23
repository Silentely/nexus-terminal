import * as PathHistoryRepository from '../path-history/path-history.repository';
import { PathHistoryEntry } from '../path-history/path-history.repository';

/**
 * 添加一条路径历史记录
 * @param path - 要添加的路径
 * @returns 返回添加记录的 ID
 */
export const addPathHistory = async (path: string): Promise<number> => {
  // 可以在这里添加额外的业务逻辑，例如校验路径格式、长度限制等
  if (!path || path.trim().length === 0) {
    throw new Error('路径不能为空');
  }

  // 调用 upsertPath 来处理插入或更新时间戳
  return PathHistoryRepository.upsertPath(path.trim());
};

/**
 * 获取所有路径历史记录
 * @returns 返回所有历史记录条目数组，按时间戳升序
 */
export const getAllPathHistory = async (): Promise<PathHistoryEntry[]> => {
  return PathHistoryRepository.getAllPaths();
};

/**
 * 根据 ID 删除一条路径历史记录
 * @param id - 要删除的记录 ID
 * @returns 返回是否成功删除 (删除行数 > 0)
 */
export const deletePathHistoryById = async (id: number): Promise<boolean> => {
  const success = await PathHistoryRepository.deletePathById(id);
  return success;
};

/**
 * 清空所有路径历史记录
 * @returns 返回删除的记录条数
 */
export const clearAllPathHistory = async (): Promise<number> => {
  return PathHistoryRepository.clearAllPaths();
};
