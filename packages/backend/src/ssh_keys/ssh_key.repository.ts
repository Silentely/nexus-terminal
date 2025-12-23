import { Database, RunResult } from 'sqlite3'; // Import Database type if needed by helpers
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';

// 定义数据库行的接口
export interface SshKeyDbRow {
  id: number;
  name: string;
  encrypted_private_key: string;
  encrypted_passphrase?: string | null; // 密码短语是可选的
  created_at: number;
  updated_at: number;
}

// 定义创建时需要的数据接口 (不包含 id, created_at, updated_at)
export type CreateSshKeyData = Omit<SshKeyDbRow, 'id' | 'created_at' | 'updated_at'>;

// 定义更新时需要的数据接口 (所有字段可选，除了 id)
export type UpdateSshKeyData = Partial<Omit<SshKeyDbRow, 'id' | 'created_at'>>;

/**
 * 创建新的 SSH 密钥记录
 * @param data - 包含密钥名称和加密后凭证的对象
 * @returns Promise<number> 新创建记录的 ID
 */
export const createSshKey = async (data: CreateSshKeyData): Promise<number> => {
  const sql = `
        INSERT INTO ssh_keys (name, encrypted_private_key, encrypted_passphrase, created_at, updated_at)
        VALUES (?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
    `;
  const params = [data.name, data.encrypted_private_key, data.encrypted_passphrase ?? null];
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, params);
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw new Error('创建 SSH 密钥后未能获取有效的 lastID');
    }
    console.log(`Repository: SSH 密钥创建成功，ID: ${result.lastID}`);
    return result.lastID;
  } catch (err: any) {
    // Catch potential errors from helpers
    console.error('Repository: 创建 SSH 密钥失败:', err.message);
    throw new Error(`创建 SSH 密钥失败: ${err.message}`);
  }
};

/**
 * 根据 ID 查找 SSH 密钥
 * @param id - 密钥 ID
 * @returns Promise<SshKeyDbRow | null> 找到的密钥记录或 null
 */
export const findSshKeyById = async (id: number): Promise<SshKeyDbRow | null> => {
  const sql = `SELECT * FROM ssh_keys WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const row = await getDbRow<SshKeyDbRow>(db, sql, [id]);
    return row || null;
  } catch (err: any) {
    console.error(`Repository: 查找 SSH 密钥 ${id} 失败:`, err.message);
    throw new Error(`查找 SSH 密钥失败: ${err.message}`);
  }
};

/**
 * 查找所有 SSH 密钥 (只包含 id 和 name，用于列表显示)
 * @returns Promise<{ id: number; name: string }[]> 密钥列表
 */
export const findAllSshKeyNames = async (): Promise<{ id: number; name: string }[]> => {
  const sql = `SELECT id, name FROM ssh_keys ORDER BY name ASC`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<{ id: number; name: string }>(db, sql);
    return rows;
  } catch (err: any) {
    console.error('Repository: 查找所有 SSH 密钥名称失败:', err.message);
    throw new Error(`查找所有 SSH 密钥名称失败: ${err.message}`);
  }
};

/**
 * 查找所有 SSH 密钥的完整记录
 * @returns Promise<SshKeyDbRow[]> 密钥列表
 */
export const findAllSshKeys = async (): Promise<SshKeyDbRow[]> => {
  const sql = `SELECT * FROM ssh_keys ORDER BY name ASC`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<SshKeyDbRow>(db, sql);
    return rows;
  } catch (err: any) {
    console.error('Repository: 查找所有 SSH 密钥记录失败:', err.message);
    throw new Error(`查找所有 SSH 密钥记录失败: ${err.message}`);
  }
};

/**
 * 更新 SSH 密钥记录
 * @param id - 要更新的密钥 ID
 * @param data - 包含要更新字段的对象
 * @returns Promise<boolean> 是否更新成功
 */
export const updateSshKey = async (id: number, data: UpdateSshKeyData): Promise<boolean> => {
  // 过滤掉 undefined 的值
  const fieldsToUpdate = Object.entries(data)
    .filter(([_, value]) => value !== undefined)
    .reduce(
      (obj, [key, value]) => {
        (obj as any)[key] = value;
        return obj;
      },
      {} as { [key: string]: any }
    ); // Type assertion for index signature

  if (Object.keys(fieldsToUpdate).length === 0) {
    console.log(`Repository: 更新 SSH 密钥 ${id} 时没有提供有效字段。`);
    return true; // 没有字段需要更新
  }

  // 添加 updated_at 时间戳
  fieldsToUpdate.updated_at = Math.floor(Date.now() / 1000);

  const setClause = Object.keys(fieldsToUpdate)
    .map((field) => `${field} = ?`)
    .join(', ');
  const values = Object.values(fieldsToUpdate).map((value) => value ?? null); // 处理 null 值

  const sql = `UPDATE ssh_keys SET ${setClause} WHERE id = ?`;
  const params = [...values, id];

  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, params);
    return result.changes > 0; // 如果有行被改变则返回 true
  } catch (err: any) {
    console.error(`Repository: 更新 SSH 密钥 ${id} 失败:`, err.message);
    throw new Error(`更新 SSH 密钥失败: ${err.message}`);
  }
};

/**
 * 删除 SSH 密钥记录
 * @param id - 要删除的密钥 ID
 * @returns Promise<boolean> 是否删除成功
 */
export const deleteSshKey = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM ssh_keys WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0; // 如果有行被删除则返回 true
  } catch (err: any) {
    console.error(`Repository: 删除 SSH 密钥 ${id} 失败:`, err.message);
    throw new Error(`删除 SSH 密钥失败: ${err.message}`);
  }
};
