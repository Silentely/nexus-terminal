import { Database, Statement } from 'sqlite3';
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';

// 定义 Tag 类型 (可以共享到 types 文件)
export interface TagData {
  id: number;
  name: string;
  created_at: number;
  updated_at: number;
}

/**
 * 获取所有标签
 */
export const findAllTags = async (): Promise<TagData[]> => {
  try {
    const db = await getDbInstance();
    const rows = await allDb<TagData>(db, `SELECT * FROM tags ORDER BY name ASC`);
    return rows;
  } catch (err: any) {
    console.error('[仓库] 查询标签列表时出错:', err.message);
    throw new Error('获取标签列表失败');
  }
};

/**
 * 根据 ID 获取单个标签
 */
export const findTagById = async (id: number): Promise<TagData | null> => {
  try {
    const db = await getDbInstance();
    const row = await getDbRow<TagData>(db, `SELECT * FROM tags WHERE id = ?`, [id]);
    return row || null;
  } catch (err: any) {
    console.error(`[仓库] 查询标签 ${id} 时出错:`, err.message);
    throw new Error('获取标签信息失败');
  }
};

/**
 * 创建新标签
 */
export const createTag = async (name: string): Promise<number> => {
  const now = Math.floor(Date.now() / 1000);
  const sql = `INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [name, now, now]);
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw new Error('创建标签后未能获取有效的 lastID');
    }
    return result.lastID;
  } catch (err: any) {
    console.error('[仓库] 创建标签时出错:', err.message);
    if (err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`标签名称 "${name}" 已存在。`);
    }
    throw new Error(`创建标签失败: ${err.message}`);
  }
};

/**
 * 更新标签名称
 */
export const updateTag = async (id: number, name: string): Promise<boolean> => {
  const now = Math.floor(Date.now() / 1000);
  const sql = `UPDATE tags SET name = ?, updated_at = ? WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [name, now, id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error(`[仓库] 更新标签 ${id} 时出错:`, err.message);
    if (err.message.includes('UNIQUE constraint failed')) {
      throw new Error(`标签名称 "${name}" 已存在。`);
    }
    throw new Error(`更新标签失败: ${err.message}`);
  }
};

/**
 * 删除标签
 */
export const deleteTag = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM tags WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error(`[仓库] 删除标签 ${id} 时出错:`, err.message);
    throw new Error('删除标签失败');
  }
};

/**
 * 更新标签与连接的关联关系
 */
export const updateTagConnections = async (
  tagId: number,
  connectionIds: number[]
): Promise<void> => {
  const db = await getDbInstance();
  try {
    // 开始事务
    await runDb(db, 'BEGIN TRANSACTION');

    // 1. 删除该标签旧的连接关联
    const deleteSql = `DELETE FROM connection_tags WHERE tag_id = ?`;
    await runDb(db, deleteSql, [tagId]);

    // 2. 如果有新的连接 ID，则插入新的关联
    if (connectionIds && connectionIds.length > 0) {
      const insertSql = `INSERT INTO connection_tags (tag_id, connection_id) VALUES (?, ?)`;
      // 使用 Promise.all 来并行执行插入操作，或者逐个执行
      // 为简单起见，这里逐个执行，但对于大量数据，并行或批量插入更优
      for (const connectionId of connectionIds) {
        // 检查 connectionId 是否有效（例如，是否存在于 connections 表中）可以增加健壮性，但此处省略
        await runDb(db, insertSql, [tagId, connectionId]);
      }
    }

    // 提交事务
    await runDb(db, 'COMMIT');
  } catch (err: any) {
    // 如果发生错误，回滚事务
    await runDb(db, 'ROLLBACK');
    console.error(`[仓库] 更新标签 ${tagId} 的连接关联时出错:`, err.message);
    throw new Error(`更新标签连接关联失败: ${err.message}`);
  }
};
