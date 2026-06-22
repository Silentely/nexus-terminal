import { Database } from 'sqlite3';
import { ErrorFactory, getErrorMessage } from '../utils/AppError';
import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { logger } from '../utils/logger';
import { cacheService } from '../services/cache.service';

// 缓存配置
const CONNECTIONS_CACHE_TTL = 2 * 60 * 1000; // 2 分钟
const CONNECTIONS_CACHE_KEY = 'connections:allWithTags';

// Define Connection 类型 (可以从 controller 或 types 文件导入，暂时在此定义)
// 注意：这里不包含加密字段，因为 Repository 不应处理解密
interface ConnectionBase {
  id: number;
  name: string | null;
  type: 'SSH' | 'RDP' | 'VNC';
  host: string;
  port: number;
  username: string;
  auth_method: 'password' | 'key';
  proxy_id: number | null;
  proxy_type?: 'proxy' | 'jump' | null; // 新增连接本身的 proxy_type
  created_at: number;
  updated_at: number;
  last_connected_at: number | null;
  ssh_key_id?: number | null;
  notes?: string | null;
  //    jump_chain: number[] | null; // <-- REMOVE from ConnectionBase
}

// ConnectionWithTagsRow implicitly includes 'type' and 'ssh_key_id' via ConnectionBase
interface ConnectionWithTagsRow extends ConnectionBase {
  // This will no longer cause error if ConnectionBase has no jump_chain
  tag_ids_str: string | null;
  jump_chain: string | null; // Stored as JSON string in DB
  force_keyboard_interactive: number | 0 | 1; // BOOLEAN in SQLite is stored as 0/1
}

// ConnectionWithTags implicitly includes 'type' and 'ssh_key_id' via ConnectionBase
export interface ConnectionWithTags extends ConnectionBase {
  tag_ids: number[];
  jump_chain: number[] | null; // Explicitly add for service layer type
  force_keyboard_interactive: boolean;
}

// 包含加密字段的完整类型，用于插入/更新
// FullConnectionData implicitly includes 'type' via ConnectionBase
export interface FullConnectionData extends ConnectionBase {
  encrypted_password?: string | null;
  encrypted_private_key?: string | null;
  encrypted_passphrase?: string | null;
  notes?: string | null;
  tag_ids?: number[];
  jump_chain: number[] | null; // Explicitly add for service layer input type
  proxy_type?: 'proxy' | 'jump' | null; // 新增连接本身的 proxy_type
  force_keyboard_interactive?: boolean;
}

interface FullConnectionDbRow extends Omit<FullConnectionData, 'jump_chain' | 'tag_ids'> {
  // Omit service layer type, and tag_ids (not directly on connections table)
  ssh_key_id?: number | null;
  jump_chain: string | null; // Stored as JSON string in DB
  proxy_type?: 'proxy' | 'jump' | null; // 连接本身的 proxy_type, from c.proxy_type
  proxy_db_id: number | null;
  proxy_name: string | null;
  actual_proxy_server_type: string | null; // p.type AS actual_proxy_server_type
  proxy_host: string | null;
  proxy_port: number | null;
  proxy_username: string | null;
  proxy_encrypted_password?: string | null;
  proxy_encrypted_private_key?: string | null;
  proxy_encrypted_passphrase?: string | null;
}

type BulkInsertConnectionInput = Omit<
  FullConnectionData,
  'id' | 'created_at' | 'updated_at' | 'last_connected_at'
> & {
  tag_ids?: number[];
};

interface BulkInsertConnectionResult {
  connectionId: number;
  originalData: BulkInsertConnectionInput;
}

type ConnectionUpdateFields = Record<string, unknown> & {
  updated_at?: number;
};
type SqlParamValue = string | number | boolean | null;

/**
 * 获取所有连接及其标签
 */
export const findAllConnectionsWithTags = async (): Promise<ConnectionWithTags[]> => {
  // 1. 先查缓存
  const cached = cacheService.get<ConnectionWithTags[]>(CONNECTIONS_CACHE_KEY);
  if (cached) {
    return cached;
  }

  // 2. 查数据库
  const sql = `
        SELECT
            c.id, c.name, c.type, c.host, c.port, c.username, c.auth_method, c.proxy_id, c.proxy_type, c.ssh_key_id, c.notes, c.jump_chain, c.force_keyboard_interactive, -- +++ Select force_keyboard_interactive +++
            c.created_at, c.updated_at, c.last_connected_at,
            GROUP_CONCAT(ct.tag_id) as tag_ids_str
         FROM connections c
         LEFT JOIN connection_tags ct ON c.id = ct.connection_id
         GROUP BY c.id
         ORDER BY c.name ASC`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<ConnectionWithTagsRow>(db, sql);
    const result = rows.map((row) => {
      const { jump_chain: jumpChainStr, force_keyboard_interactive, ...restOfRow } = row;
      return {
        ...restOfRow,
        tag_ids: row.tag_ids_str
          ? row.tag_ids_str
              .split(',')
              .map(Number)
              .filter((tagId) => !Number.isNaN(tagId))
          : [],
        jump_chain: jumpChainStr ? (JSON.parse(jumpChainStr) as number[]) : null,
        force_keyboard_interactive: Boolean(force_keyboard_interactive),
      } as ConnectionWithTags;
    });

    // 3. 写入缓存
    cacheService.set(CONNECTIONS_CACHE_KEY, result, CONNECTIONS_CACHE_TTL);

    return result;
  } catch (err: unknown) {
    logger.error('Repository: 查询连接列表时出错:', getErrorMessage(err));
    throw ErrorFactory.databaseError('获取连接列表失败', '获取连接列表失败');
  }
};

/**
 * 根据 ID 获取单个连接及其标签
 */
export const findConnectionByIdWithTags = async (
  id: number,
): Promise<ConnectionWithTags | null> => {
  const sql = `
        SELECT
            c.id, c.name, c.type, c.host, c.port, c.username, c.auth_method, c.proxy_id, c.proxy_type, c.ssh_key_id, c.notes, c.jump_chain, c.force_keyboard_interactive,
            c.created_at, c.updated_at, c.last_connected_at,
            GROUP_CONCAT(ct.tag_id) as tag_ids_str
         FROM connections c
         LEFT JOIN connection_tags ct ON c.id = ct.connection_id
         WHERE c.id = ?
         GROUP BY c.id`;
  try {
    const db = await getDbInstance();
    const row = await getDbRow<ConnectionWithTagsRow>(db, sql, [id]);
    if (row && typeof row.id !== 'undefined') {
      const { jump_chain: jumpChainStr, force_keyboard_interactive, ...restOfRow } = row;
      return {
        ...restOfRow,
        tag_ids: row.tag_ids_str
          ? row.tag_ids_str
              .split(',')
              .map(Number)
              .filter((tagId) => !Number.isNaN(tagId))
          : [],
        jump_chain: jumpChainStr ? (JSON.parse(jumpChainStr) as number[]) : null,
        force_keyboard_interactive: Boolean(force_keyboard_interactive),
      } as ConnectionWithTags;
    }
    return null;
  } catch (err: unknown) {
    logger.error(`Repository: 查询连接 ${id} 时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('获取连接信息失败', '获取连接信息失败');
  }
};

/**
 * 根据 ID 获取单个连接的完整信息 (包括加密字段和代理信息)
 */
export const findFullConnectionById = async (id: number): Promise<FullConnectionDbRow | null> => {
  const sql = `
         SELECT
             c.*, -- 选择 connections 表所有列 (包括 c.proxy_type)
             p.id as proxy_db_id, p.name as proxy_name, p.type as actual_proxy_server_type, -- Renamed p.type to avoid conflict
             p.host as proxy_host, p.port as proxy_port, p.username as proxy_username,
             p.encrypted_password as proxy_encrypted_password,
             p.encrypted_private_key as proxy_encrypted_private_key,
             p.encrypted_passphrase as proxy_encrypted_passphrase
          FROM connections c
          LEFT JOIN proxies p ON c.proxy_id = p.id
          WHERE c.id = ?`;
  try {
    const db = await getDbInstance();
    const row = await getDbRow<FullConnectionDbRow>(db, sql, [id]);
    return row || null;
  } catch (err: unknown) {
    logger.error(`Repository: 查询连接 ${id} 详细信息时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('获取连接详细信息失败', '获取连接详细信息失败');
  }
};

/**
 * 根据名称查找连接 (用于检查名称是否重复)
 */
export const findConnectionByName = async (name: string): Promise<ConnectionBase | null> => {
  const sql = `SELECT id, name, type, host, port, username, auth_method, proxy_id, proxy_type, ssh_key_id, notes, jump_chain, created_at, updated_at, last_connected_at FROM connections WHERE name = ?`; // Added jump_chain and proxy_type
  try {
    const db = await getDbInstance();
    // Cast to ConnectionWithTagsRow to read jump_chain as string, then parse. It will now also have proxy_type
    const row = await getDbRow<ConnectionWithTagsRow>(db, sql, [name]);
    if (row) {
      const { jump_chain: _jumpChainStr, tag_ids_str: _tagIdsStr, ...restOfRow } = row; // Exclude tag_ids_str as well for ConnectionBase
      return {
        ...restOfRow,
        // ConnectionBase does not have jump_chain, so we don't add it here.
        // If we need jump_chain for findConnectionByName and the result type is ConnectionBase,
        // then ConnectionBase itself needs jump_chain: number[] | null.
        // For now, assuming ConnectionBase should NOT have jump_chain for this function's return.
        // If it SHOULD, ConnectionBase needs jump_chain: number[] | null, and the parsing is correct.
        // Let's assume ConnectionBase should NOT have it to keep it truly base.
        // The caller using findConnectionByName might not expect jump_chain.
        // If service needs it, it should use a find method that returns a richer type.
      } as ConnectionBase; // jump_chain is not part of ConnectionBase anymore
    }
    return null; // Ensure null is returned if row is null
  } catch (err: unknown) {
    logger.error(`Repository: 查询连接名称 "${name}" 时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('查找连接名称失败', '查找连接名称失败');
  }
};

/**
 * 创建新连接 (不处理标签)
 */
// Update input type to reflect FullConnectionData now has 'type' and 'jump_chain'
export const createConnection = async (
  data: Omit<
    FullConnectionData,
    'id' | 'created_at' | 'updated_at' | 'last_connected_at' | 'tag_ids'
  >,
): Promise<number> => {
  logger.debug('[Repository:createConnection] Received data:', JSON.stringify(data, null, 2));
  const now = Math.floor(Date.now() / 1000);
  const sql = `
        INSERT INTO connections (name, type, host, port, username, auth_method, encrypted_password, encrypted_private_key, encrypted_passphrase, proxy_id, proxy_type, ssh_key_id, notes, jump_chain, force_keyboard_interactive, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  const jumpChainStringified =
    data.jump_chain && data.jump_chain.length > 0 ? JSON.stringify(data.jump_chain) : null;
  logger.debug(
    `[Repository:createConnection] jump_chain input: ${JSON.stringify(data.jump_chain)}, stringified to: ${jumpChainStringified}`,
  );

  const params = [
    data.name ?? null,
    data.type,
    data.host,
    data.port,
    data.username,
    data.auth_method,
    data.encrypted_password ?? null,
    data.encrypted_private_key ?? null,
    data.encrypted_passphrase ?? null,
    data.proxy_id ?? null,
    data.proxy_type ?? null,
    data.ssh_key_id ?? null,
    data.notes ?? null,
    jumpChainStringified,
    data.force_keyboard_interactive ? 1 : 0,
    now,
    now,
  ];
  logger.debug('[Repository:createConnection] SQL:', sql);
  logger.debug('[Repository:createConnection] Params:', JSON.stringify(params, null, 2));
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, params);
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw ErrorFactory.databaseError('创建连接失败', '创建连接后未能获取有效的 lastID');
    }
    // 写入成功后失效缓存
    cacheService.delete(CONNECTIONS_CACHE_KEY);
    return result.lastID;
  } catch (err: unknown) {
    logger.error('Repository: 插入连接时出错:', getErrorMessage(err));
    throw ErrorFactory.databaseError('创建连接记录失败', '创建连接记录失败');
  }
};

/**
 * 更新连接信息 (不处理标签)
 */
// Update input type to reflect FullConnectionData now has 'type' and 'jump_chain'
export const updateConnection = async (
  id: number,
  data: Partial<Omit<FullConnectionData, 'id' | 'created_at' | 'last_connected_at' | 'tag_ids'>>,
): Promise<boolean> => {
  logger.debug(
    `[Repository:updateConnection] Received data for ID ${id}:`,
    JSON.stringify(data, null, 2),
  );
  const fieldsToUpdate: ConnectionUpdateFields = { ...data };
  const params: SqlParamValue[] = [];

  delete fieldsToUpdate.id;
  delete fieldsToUpdate.created_at;
  delete fieldsToUpdate.last_connected_at;
  delete fieldsToUpdate.tag_ids;

  fieldsToUpdate.updated_at = Math.floor(Date.now() / 1000);

  // 允许更新的列名白名单，防止 SQL 注入
  const ALLOWED_UPDATE_COLUMNS = new Set([
    'name',
    'type',
    'host',
    'port',
    'username',
    'auth_method',
    'encrypted_password',
    'encrypted_private_key',
    'encrypted_passphrase',
    'proxy_id',
    'proxy_type',
    'ssh_key_id',
    'notes',
    'jump_chain',
    'force_keyboard_interactive',
    'is_monitored',
    'sort_order',
    'updated_at',
  ]);

  // 过滤掉不在白名单中的列
  for (const key of Object.keys(fieldsToUpdate)) {
    if (!ALLOWED_UPDATE_COLUMNS.has(key)) {
      logger.warn(`[Repository:updateConnection] 忽略不在白名单中的列: ${key}`);
      delete fieldsToUpdate[key as keyof ConnectionUpdateFields];
    }
  }

  // 过滤后如果除了 updated_at 没有其他业务字段，直接返回避免无意义的时间戳更新
  const businessFields = Object.keys(fieldsToUpdate).filter((k) => k !== 'updated_at');
  if (businessFields.length === 0) {
    logger.debug(`[Repository:updateConnection] 没有需要更新的业务字段，跳过更新 (ID: ${id})`);
    return false;
  }

  const setClauses = Object.keys(fieldsToUpdate)
    .map((key) => `${key} = ?`)
    .join(', ');

  Object.keys(fieldsToUpdate).forEach((key) => {
    const K = key as keyof typeof fieldsToUpdate;
    const value = fieldsToUpdate[K];
    if (K === 'jump_chain') {
      const jumpChainValue = value as number[] | null;
      const jumpChainStringified =
        jumpChainValue && jumpChainValue.length > 0 ? JSON.stringify(jumpChainValue) : null;
      logger.debug(
        `[Repository:updateConnection] jump_chain input for ID ${id}: ${JSON.stringify(jumpChainValue)}, stringified to: ${jumpChainStringified}`,
      );
      params.push(jumpChainStringified);
    } else if (K === 'force_keyboard_interactive') {
      // 布尔值转换为整数存储
      params.push(value ? 1 : 0);
    } else {
      if (
        typeof value === 'string' ||
        typeof value === 'number' ||
        typeof value === 'boolean' ||
        value === null ||
        value === undefined
      ) {
        params.push((value ?? null) as SqlParamValue);
      } else {
        params.push(String(value));
      }
    }
  });

  if (!setClauses) {
    logger.warn(`[Repository] updateConnection called for ID ${id} with no fields to update.`);
    return false;
  }

  params.push(id);
  const sql = `UPDATE connections SET ${setClauses} WHERE id = ?`;
  logger.debug(`[Repository:updateConnection] SQL for ID ${id}:`, sql);
  logger.debug(
    `[Repository:updateConnection] Params for ID ${id}:`,
    JSON.stringify(params, null, 2),
  );

  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, params);
    // 写入成功后失效缓存
    if (result.changes > 0) {
      cacheService.delete(CONNECTIONS_CACHE_KEY);
    }
    return result.changes > 0;
  } catch (err: unknown) {
    logger.error(`Repository: 更新连接 ${id} 时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('更新连接记录失败', '更新连接记录失败');
  }
};

/**
 * 删除连接
 */
export const deleteConnection = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM connections WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    // 删除成功后失效缓存
    if (result.changes > 0) {
      cacheService.delete(CONNECTIONS_CACHE_KEY);
    }
    return result.changes > 0;
  } catch (err: unknown) {
    logger.error(`Repository: 删除连接 ${id} 时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('删除连接记录失败', '删除连接记录失败');
  }
};

/**
 * 更新指定连接的 last_connected_at 时间戳
 * @param id 连接 ID
 * @param timestamp Unix 时间戳 (秒)
 */
export const updateLastConnected = async (id: number, timestamp: number): Promise<boolean> => {
  const sql = `UPDATE connections SET last_connected_at = ? WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [timestamp, id]);
    if (result.changes === 0) {
      logger.warn(`[Repository] updateLastConnected: No connection found with ID ${id} to update.`);
    } else {
      // 更新成功后失效缓存
      cacheService.delete(CONNECTIONS_CACHE_KEY);
    }
    return result.changes > 0;
  } catch (err: unknown) {
    logger.error(`Repository: 更新连接 ${id} 的 last_connected_at 时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('更新上次连接时间失败', '更新上次连接时间失败');
  }
};

/**
 * 更新连接的标签关联 (使用事务)
 * @param connectionId 连接 ID
 * @param tagIds 新的标签 ID 数组 (空数组表示清除所有标签)
 */
export const updateConnectionTags = async (
  connectionId: number,
  tagIds: number[],
): Promise<boolean> => {
  // 修改返回类型为 boolean
  const db = await getDbInstance();

  // 1. 检查连接是否存在
  try {
    const connectionExists = await getDbRow<{ id: number }>(
      db,
      `SELECT id FROM connections WHERE id = ?`,
      [connectionId],
    );
    if (!connectionExists) {
      logger.warn(
        `Repository: updateConnectionTags - Connection with ID ${connectionId} not found.`,
      );
      return false; // 连接不存在，返回 false
    }
  } catch (checkErr: unknown) {
    logger.error(`Repository: 检查连接 ${connectionId} 是否存在时出错:`, getErrorMessage(checkErr));
    throw ErrorFactory.databaseError('检查连接是否存在时失败', '检查连接是否存在时失败'); // 抛出检查错误
  }

  // 2. 执行标签更新事务
  try {
    await runDb(db, 'BEGIN TRANSACTION');

    // 删除旧关联
    await runDb(db, `DELETE FROM connection_tags WHERE connection_id = ?`, [connectionId]);

    // 插入新关联 (如果 tagIds 不为空)
    if (tagIds.length > 0) {
      const insertSql = `INSERT INTO connection_tags (connection_id, tag_id) VALUES (?, ?)`;
      // 过滤无效 ID
      const validTagIds = tagIds.filter((tagId) => typeof tagId === 'number' && tagId > 0);

      // 使用 Promise.all 确保所有插入完成或失败
      const insertPromises = validTagIds.map((tagId) =>
        runDb(db, insertSql, [connectionId, tagId]),
      );
      // 如果任何插入失败，Promise.all 会 reject，错误会被下面的 catch 捕获
      await Promise.all(insertPromises);
    }

    await runDb(db, 'COMMIT');
    // 写入成功后失效缓存
    cacheService.delete(CONNECTIONS_CACHE_KEY);
    return true; // 事务成功提交，返回 true
  } catch (err: unknown) {
    logger.error(`Repository: 更新连接 ${connectionId} 的标签关联事务出错:`, getErrorMessage(err));
    try {
      await runDb(db, 'ROLLBACK');
      logger.debug(
        `Repository: Transaction rolled back for connection ${connectionId} tag update.`,
      );
    } catch (rollbackErr: unknown) {
      logger.error(
        `Repository: 回滚连接 ${connectionId} 的标签更新事务失败:`,
        getErrorMessage(rollbackErr),
      );
      // 即使回滚失败，原始错误也更重要
    }
    // 直接重新抛出原始事务错误，让上层处理
    // SQLite 在事务中遇到错误时通常会自动回滚
    throw err;
  }
};

/**
 * 查找指定连接的所有标签
 * @param connectionId 连接 ID
 * @returns 标签对象数组 { id: number, name: string }[]
 */
export const findConnectionTags = async (
  connectionId: number,
): Promise<{ id: number; name: string }[]> => {
  const sql = `
        SELECT t.id, t.name
        FROM tags t
        JOIN connection_tags ct ON t.id = ct.tag_id
        WHERE ct.connection_id = ?`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<{ id: number; name: string }>(db, sql, [connectionId]);
    return rows;
  } catch (err: unknown) {
    logger.error(`Repository: 查询连接 ${connectionId} 的标签时出错:`, getErrorMessage(err));
    throw ErrorFactory.databaseError('获取连接标签失败', '获取连接标签失败');
  }
};

/**
 * 批量插入连接（用于导入）
 * 注意：此函数应在事务中调用 (由调用者负责事务)
 */
export const bulkInsertConnections = async (
  db: Database,
  // Update input type to reflect FullConnectionData now has 'type'
  connections: BulkInsertConnectionInput[],
): Promise<BulkInsertConnectionResult[]> => {
  const insertConnSql = `INSERT INTO connections (name, type, host, port, username, auth_method, encrypted_password, encrypted_private_key, encrypted_passphrase, proxy_id, proxy_type, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`; // Add type, proxy_type and notes columns and placeholders
  const results: BulkInsertConnectionResult[] = [];
  const now = Math.floor(Date.now() / 1000);

  for (const connData of connections) {
    const params = [
      connData.name ?? null,
      connData.type,
      connData.host,
      connData.port,
      connData.username,
      connData.auth_method, // Add type parameter
      connData.encrypted_password || null,
      connData.encrypted_private_key || null,
      connData.encrypted_passphrase || null,
      connData.proxy_id || null,
      connData.proxy_type || null, // Add proxy_type parameter
      connData.notes || null, // Add notes parameter
      now,
      now,
    ];
    try {
      const connResult = await runDb(db, insertConnSql, params);
      if (typeof connResult.lastID !== 'number' || connResult.lastID <= 0) {
        throw ErrorFactory.databaseError(
          '批量插入连接失败',
          `插入连接 "${connData.name}" 后未能获取有效的 lastID`,
        );
      }
      results.push({ connectionId: connResult.lastID, originalData: connData });
    } catch (err: unknown) {
      logger.error(`Repository: 批量插入连接 "${connData.name}" 时出错: ${getErrorMessage(err)}`);
      throw ErrorFactory.databaseError(
        '批量插入连接失败',
        `批量插入连接 "${connData.name}" 失败: ${getErrorMessage(err)}`,
      );
    }
  }
  return results;
};

/**
 * 为多个连接添加同一个标签 (使用事务)
 * @param connectionIds 连接 ID 数组
 * @param tagId 要添加的标签 ID
 */
export const addTagToMultipleConnections = async (
  connectionIds: number[],
  tagId: number,
): Promise<void> => {
  if (connectionIds.length === 0 || typeof tagId !== 'number' || tagId <= 0) {
    logger.warn(
      '[Repository] addTagToMultipleConnections called with empty connectionIds or invalid tagId.',
    );
    return; // 无需操作
  }

  const db = await getDbInstance();
  try {
    await runDb(db, 'BEGIN TRANSACTION');

    const insertSql = `INSERT OR IGNORE INTO connection_tags (connection_id, tag_id) VALUES (?, ?)`;
    // 使用 Promise.all 确保所有插入完成或失败
    const insertPromises = connectionIds.map((connId) => runDb(db, insertSql, [connId, tagId]));
    await Promise.all(insertPromises);

    await runDb(db, 'COMMIT');
    // 写入成功后失效缓存
    cacheService.delete(CONNECTIONS_CACHE_KEY);
  } catch (err: unknown) {
    const errMsg = getErrorMessage(err);
    logger.error(`Repository: 为多个连接添加标签 ${tagId} 时事务出错:`, errMsg);
    try {
      await runDb(db, 'ROLLBACK');
    } catch (rollbackErr: unknown) {
      logger.error(
        `Repository: 回滚为多个连接添加标签 ${tagId} 的事务失败:`,
        getErrorMessage(rollbackErr),
      );
    }
    throw ErrorFactory.databaseError('批量关联标签失败', `为多个连接添加标签失败: ${errMsg}`);
  }
};
