import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { ErrorFactory } from '../utils/AppError';

// 定义命令历史记录的接口
export interface CommandHistoryEntry {
  id: number;
  command: string;
  timestamp: number; // Unix 时间戳 (秒)
}

type DbCommandHistoryRow = CommandHistoryEntry;

/**
 * 插入或更新一条命令历史记录。
 * 如果命令已存在，则更新其时间戳；否则，插入新记录。
 * @param command - 要添加或更新的命令字符串
 * @returns 返回插入或更新记录的 ID
 */
export const upsertCommand = async (command: string): Promise<number> => {
  const now = Math.floor(Date.now() / 1000); // 获取当前时间戳
  const db = await getDbInstance();

  try {
    // 1. 尝试更新现有记录的时间戳
    const updateSql = `UPDATE command_history SET timestamp = ? WHERE command = ?`;
    const updateResult = await runDb(db, updateSql, [now, command]);

    if (updateResult.changes > 0) {
      // 更新成功，需要获取被更新记录的 ID
      const selectSql = `SELECT id FROM command_history WHERE command = ? ORDER BY timestamp DESC LIMIT 1`;
      const row = await getDbRow<{ id: number }>(db, selectSql, [command]);
      if (row) {
        return row.id;
      }
      // This case should theoretically not happen if update succeeded
      throw ErrorFactory.databaseError('更新成功但无法找到记录 ID', '更新成功但无法找到记录 ID');
    } else {
      // 2. 没有记录被更新，说明命令不存在，执行插入
      const insertSql = `INSERT INTO command_history (command, timestamp) VALUES (?, ?)`;
      const insertResult = await runDb(db, insertSql, [command, now]);
      // Ensure lastID is valid before returning
      if (typeof insertResult.lastID !== 'number' || insertResult.lastID <= 0) {
        throw ErrorFactory.databaseError('插入新命令历史记录后未能获取有效的 lastID', '插入新命令历史记录后未能获取有效的 lastID');
      }
      return insertResult.lastID;
    }
  } catch (err: any) {
    console.error('Upsert 命令历史记录时出错:', err.message);
    throw ErrorFactory.databaseError('无法更新或插入命令历史记录', '无法更新或插入命令历史记录');
  }
};

/**
 * 获取所有命令历史记录，按时间戳升序排列（最旧的在前）
 * @returns 返回包含所有历史记录条目的数组
 */
export const getAllCommands = async (): Promise<CommandHistoryEntry[]> => {
  const sql = `SELECT id, command, timestamp FROM command_history ORDER BY timestamp ASC`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<DbCommandHistoryRow>(db, sql);
    return rows;
  } catch (err: any) {
    console.error('获取命令历史记录时出错:', err.message);
    throw ErrorFactory.databaseError('无法获取命令历史记录', '无法获取命令历史记录');
  }
};

/**
 * 根据 ID 删除指定的命令历史记录
 * @param id - 要删除的记录 ID
 * @returns 返回是否成功删除 (true/false)
 */
export const deleteCommandById = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM command_history WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error('删除命令历史记录时出错:', err.message);
    throw ErrorFactory.databaseError('无法删除命令历史记录', '无法删除命令历史记录');
  }
};

/**
 * 清空所有命令历史记录
 * @returns 返回删除的行数
 */
export const clearAllCommands = async (): Promise<number> => {
  const sql = `DELETE FROM command_history`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql);
    return result.changes;
  } catch (err: any) {
    console.error('清空命令历史记录时出错:', err.message);
    throw ErrorFactory.databaseError('无法清空命令历史记录', '无法清空命令历史记录');
  }
};
