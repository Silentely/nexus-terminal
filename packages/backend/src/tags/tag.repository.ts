import {
  RepositoryUtils,
  getDbInstance,
  runDb,
  getDb as getDbRow,
  allDb,
} from '../database/base.repository';

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
  return RepositoryUtils.executeWithErrorHandling(
    async () => {
      const db = await getDbInstance();
      return allDb<TagData>(db, `SELECT * FROM tags ORDER BY name ASC`);
    },
    '查询标签列表时出错',
    '获取标签列表失败',
  );
};

/**
 * 根据 ID 获取单个标签
 */
export const findTagById = async (id: number): Promise<TagData | null> => {
  return RepositoryUtils.executeWithErrorHandling(
    async () => {
      const db = await getDbInstance();
      const row = await getDbRow<TagData>(db, `SELECT * FROM tags WHERE id = ?`, [id]);
      return row || null;
    },
    `查询标签 ${id} 时出错`,
    '获取标签信息失败',
  );
};

/**
 * 创建新标签
 */
export const createTag = async (name: string): Promise<number> => {
  return RepositoryUtils.executeWithErrorHandling(
    async () => {
      const now = RepositoryUtils.getNow();
      const db = await getDbInstance();
      const result = await runDb(
        db,
        `INSERT INTO tags (name, created_at, updated_at) VALUES (?, ?, ?)`,
        [name, now, now],
      );
      return RepositoryUtils.validateLastId(result, '创建标签后未能获取有效的 lastID');
    },
    '创建标签时出错',
    '创建标签失败',
    RepositoryUtils.createUniqueConstraintHandler('name', name, '标签名称'),
  );
};

/**
 * 更新标签名称
 */
export const updateTag = async (id: number, name: string): Promise<boolean> => {
  return RepositoryUtils.executeWithErrorHandling(
    async () => {
      const now = RepositoryUtils.getNow();
      const db = await getDbInstance();
      const result = await runDb(db, `UPDATE tags SET name = ?, updated_at = ? WHERE id = ?`, [
        name,
        now,
        id,
      ]);
      return RepositoryUtils.hasChanges(result);
    },
    `更新标签 ${id} 时出错`,
    '更新标签失败',
    RepositoryUtils.createUniqueConstraintHandler('name', name, '标签名称'),
  );
};

/**
 * 删除标签
 */
export const deleteTag = async (id: number): Promise<boolean> => {
  return RepositoryUtils.executeWithErrorHandling(
    async () => {
      const db = await getDbInstance();
      const result = await runDb(db, `DELETE FROM tags WHERE id = ?`, [id]);
      return RepositoryUtils.hasChanges(result);
    },
    `删除标签 ${id} 时出错`,
    '删除标签失败',
  );
};

/**
 * 更新标签与连接的关联关系
 */
export const updateTagConnections = async (
  tagId: number,
  connectionIds: number[],
): Promise<void> => {
  return RepositoryUtils.executeInTransaction(
    async (db) => {
      // 1. 删除该标签旧的连接关联
      await runDb(db, `DELETE FROM connection_tags WHERE tag_id = ?`, [tagId]);

      // 2. 如果有新的连接 ID，则插入新的关联
      if (connectionIds && connectionIds.length > 0) {
        for (const connectionId of connectionIds) {
          await runDb(db, `INSERT INTO connection_tags (tag_id, connection_id) VALUES (?, ?)`, [
            tagId,
            connectionId,
          ]);
        }
      }
    },
    `更新标签 ${tagId} 的连接关联时出错`,
    '更新标签连接关联失败',
  );
};
