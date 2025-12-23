import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';

export interface ProxyData {
  id: number;
  name: string;
  type: 'SOCKS5' | 'HTTP';
  host: string;
  port: number;
  username?: string | null;
  auth_method: 'none' | 'password' | 'key';
  encrypted_password?: string | null;
  encrypted_private_key?: string | null;
  encrypted_passphrase?: string | null;
  created_at: number;
  updated_at: number;
}

type DbProxyRow = ProxyData;

/**
 * 根据名称、类型、主机和端口查找代理
 */
export const findProxyByNameTypeHostPort = async (
  name: string,
  type: string,
  host: string,
  port: number
): Promise<{ id: number } | undefined> => {
  const sql = `SELECT id FROM proxies WHERE name = ? AND type = ? AND host = ? AND port = ?`;
  try {
    const db = await getDbInstance();
    const row = await getDbRow<{ id: number }>(db, sql, [name, type, host, port]);
    return row;
  } catch (err: any) {
    console.error(
      `Repository: 查找代理时出错 (name=${name}, type=${type}, host=${host}, port=${port}):`,
      err.message
    );
    throw new Error(`查找代理时出错: ${err.message}`);
  }
};

/**
 * 创建新代理
 */
export const createProxy = async (
  data: Omit<ProxyData, 'id' | 'created_at' | 'updated_at'>
): Promise<number> => {
  const now = Math.floor(Date.now() / 1000);
  const sql = `INSERT INTO proxies (name, type, host, port, username, auth_method, encrypted_password, encrypted_private_key, encrypted_passphrase, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const params = [
    data.name,
    data.type,
    data.host,
    data.port,
    data.username || null,
    data.auth_method || 'none',
    data.encrypted_password || null,
    data.encrypted_private_key || null,
    data.encrypted_passphrase || null,
    now,
    now,
  ];
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, params);
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw new Error('创建代理后未能获取有效的 lastID');
    }
    return result.lastID;
  } catch (err: any) {
    console.error('Repository: 创建代理时出错:', err.message);
    throw new Error(`创建代理时出错: ${err.message}`);
  }
};

/**
 * 获取所有代理
 */
export const findAllProxies = async (): Promise<ProxyData[]> => {
  const sql = `SELECT * FROM proxies ORDER BY name ASC`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<DbProxyRow>(db, sql);
    return rows;
  } catch (err: any) {
    console.error('Repository: 查询代理列表时出错:', err.message);
    throw new Error('获取代理列表失败');
  }
};

/**
 * 根据 ID 获取单个代理
 */
export const findProxyById = async (id: number): Promise<ProxyData | null> => {
  const sql = `SELECT * FROM proxies WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const row = await getDbRow<DbProxyRow>(db, sql, [id]);
    return row || null;
  } catch (err: any) {
    console.error(`Repository: 查询代理 ${id} 时出错:`, err.message);
    throw new Error('获取代理信息失败');
  }
};

/**
 * 更新代理信息
 */
export const updateProxy = async (
  id: number,
  data: Partial<Omit<ProxyData, 'id' | 'created_at'>>
): Promise<boolean> => {
  const fieldsToUpdate: { [key: string]: any } = { ...data };
  const params: any[] = [];
  delete fieldsToUpdate.id;
  delete fieldsToUpdate.created_at;

  fieldsToUpdate.updated_at = Math.floor(Date.now() / 1000);

  const setClauses = Object.keys(fieldsToUpdate)
    .map((key) => `${key} = ?`)
    .join(', ');
  Object.values(fieldsToUpdate).forEach((value) => params.push(value ?? null));

  if (!setClauses) {
    console.warn(`[Repository] updateProxy called for ID ${id} with no fields to update.`);
    return false;
  }

  params.push(id);

  const sql = `UPDATE proxies SET ${setClauses} WHERE id = ?`;

  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, params);
    return result.changes > 0;
  } catch (err: any) {
    console.error(`Repository: 更新代理 ${id} 时出错:`, err.message);
    throw new Error('更新代理记录失败');
  }
};

/**
 * 删除代理
 */
export const deleteProxy = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM proxies WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error(`Repository: 删除代理 ${id} 时出错:`, err.message);
    throw new Error('删除代理记录失败');
  }
};
