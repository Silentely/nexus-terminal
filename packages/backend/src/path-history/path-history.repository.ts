import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { ErrorFactory } from '../utils/AppError';

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
    // 1. 尝试更新现有记录的时间戳
    const updateSql = `UPDATE path_history SET timestamp = ? WHERE path = ?`;
    const updateResult = await runDb(db, updateSql, [now, path]);

    if (updateResult.changes > 0) {
      // 更新成功，需要获取被更新记录的 ID
      const selectSql = `SELECT id FROM path_history WHERE path = ? ORDER BY timestamp DESC LIMIT 1`;
      const row = await getDbRow<{ id: number }>(db, selectSql, [path]);
      if (row) {
        return row.id;
      }
      // This case should theoretically not happen if update succeeded
      throw ErrorFactory.databaseError('更新成功但无法找到记录 ID', '更新成功但无法找到记录 ID');
    } else {
      // 2. 没有记录被更新，说明路径不存在，执行插入
      const insertSql = `INSERT INTO path_history (path, timestamp) VALUES (?, ?)`;
      const insertResult = await runDb(db, insertSql, [path, now]);
      // Ensure lastID is valid before returning
      if (typeof insertResult.lastID !== 'number' || insertResult.lastID <= 0) {
        throw ErrorFactory.databaseError(
          '插入新路径历史记录后未能获取有效的 lastID',
          '插入新路径历史记录后未能获取有效的 lastID'
        );
      }
      return insertResult.lastID;
    }
  } catch (err: any) {
    console.error('Upsert 路径历史记录时出错:', err.message);
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
  } catch (err: any) {
    console.error('获取路径历史记录时出错:', err.message);
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
  } catch (err: any) {
    console.error('删除路径历史记录时出错:', err.message);
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
  } catch (err: any) {
    console.error('清空路径历史记录时出错:', err.message);
    throw ErrorFactory.databaseError('无法清空路径历史记录', '无法清空路径历史记录');
  }
};
