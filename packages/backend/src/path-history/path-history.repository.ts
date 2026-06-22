import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { ErrorFactory, getErrorMessage } from '../utils/AppError';
import { logger } from '../utils/logger';

// 定义路径历史记录的接口
export interface PathHistoryEntry {
  id: number;
  path: string;
  timestamp: number; // Unix 时间戳 (秒)
}

type DbPathHistoryRow = PathHistoryEntry;

/**
 * 插入或更新一条路径历史记录。
 * 如果路径已存在，则更新其时间戳；否则，插入新记录。
 * @param path - 要添加或更新的路径字符串
 * @returns 返回插入或更新记录的 ID
 */
export const upsertPath = async (path: string): Promise<number> => {
  const now = Math.floor(Date.now() / 1000); // 获取当前时间戳
  const db = await getDbInstance();

  try {
    // 使用 ON CONFLICT + RETURNING id 合并为单次原子查询
    const upsertSql = `
      INSERT INTO path_history (path, timestamp)
      VALUES (?, ?)
      ON CONFLICT(path) DO UPDATE SET timestamp = excluded.timestamp
      RETURNING id
    `;
    const row = await getDbRow<{ id: number }>(db, upsertSql, [path, now]);
    if (row?.id) {
      return row.id;
    }
    throw ErrorFactory.databaseError(
      '路径历史 UPSERT 后未能获取记录 ID',
      '路径历史 UPSERT 后未能获取记录 ID',
    );
  } catch (err: unknown) {
    logger.error('UPSERT 路径历史记录时出错:', getErrorMessage(err));
    throw ErrorFactory.databaseError('无法更新或插入路径历史记录', '无法更新或插入路径历史记录');
  }
};

/**
 * 获取所有路径历史记录，按时间戳升序排列（最旧的在前）
 * @returns 返回包含所有历史记录条目的数组
 */
export const getAllPaths = async (): Promise<PathHistoryEntry[]> => {
  const sql = `SELECT id, path, timestamp FROM path_history ORDER BY timestamp ASC`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<DbPathHistoryRow>(db, sql);
    return rows;
  } catch (err: unknown) {
    logger.error('获取路径历史记录时出错:', getErrorMessage(err));
    throw ErrorFactory.databaseError('无法获取路径历史记录', '无法获取路径历史记录');
  }
};

/**
 * 根据 ID 删除指定的路径历史记录
 * @param id - 要删除的记录 ID
 * @returns 返回是否成功删除 (true/false)
 */
export const deletePathById = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM path_history WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: unknown) {
    logger.error('删除路径历史记录时出错:', getErrorMessage(err));
    throw ErrorFactory.databaseError('无法删除路径历史记录', '无法删除路径历史记录');
  }
};

/**
 * 清空所有路径历史记录
 * @returns 返回删除的行数
 */
export const clearAllPaths = async (): Promise<number> => {
  const sql = `DELETE FROM path_history`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql);
    return result.changes;
  } catch (err: unknown) {
    logger.error('清空路径历史记录时出错:', getErrorMessage(err));
    throw ErrorFactory.databaseError('无法清空路径历史记录', '无法清空路径历史记录');
  }
};
