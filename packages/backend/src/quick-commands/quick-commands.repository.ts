import { getDbInstance, runDb, getDb as getDbRow, allDb } from '../database/connection';
import { ErrorFactory } from '../utils/AppError';

// 定义基础快捷指令接口
export interface QuickCommand {
  id: number;
  name: string | null; // 名称可选
  command: string;
  usage_count: number;
  variables?: string; // 存储 JSON 格式的变量键值对
  created_at: number; // Unix 时间戳 (秒)
  updated_at: number; // Unix 时间戳 (秒)
}

// 定义包含标签 ID 和解析后变量的接口
export type QuickCommandWithTags = Omit<QuickCommand, 'variables'> & {
  tagIds: number[];
  variables: Record<string, string> | null; // API 层面使用对象
};

// 用于从数据库获取带 tag_ids_str 的行
interface DbQuickCommandWithTagsRow extends QuickCommand {
  tag_ids_str: string | null;
  // variables 字段已包含在 QuickCommand 中，这里不需要重复定义，因为 QuickCommand 将包含 variables?: string
}

/**
 * 添加一条新的快捷指令
 * @param name - 指令名称 (可选)
 * @param command - 指令内容
 * @param variables - 变量对象 (可选)
 * @returns 返回插入记录的 ID
 */
export const addQuickCommand = async (
  name: string | null,
  command: string,
  variables?: Record<string, string>
): Promise<number> => {
  const sql = `INSERT INTO quick_commands (name, command, variables, created_at, updated_at) VALUES (?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))`;
  try {
    const db = await getDbInstance();
    const variablesJson = variables ? JSON.stringify(variables) : null;
    const result = await runDb(db, sql, [name, command, variablesJson]);
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw ErrorFactory.databaseError('添加快捷指令后未能获取有效的 lastID', '添加快捷指令后未能获取有效的 lastID');
    }
    return result.lastID;
  } catch (err: any) {
    console.error('添加快捷指令时出错:', err.message);
    throw ErrorFactory.databaseError('无法添加快捷指令', '无法添加快捷指令');
  }
};

/**
 * 更新指定的快捷指令
 * @param id - 要更新的记录 ID
 * @param name - 新的指令名称 (可选)
 * @param command - 新的指令内容
 * @param variables - 新的变量对象 (可选)
 * @returns 返回是否成功更新 (true/false)
 */
export const updateQuickCommand = async (
  id: number,
  name: string | null,
  command: string,
  variables?: Record<string, string>
): Promise<boolean> => {
  const sql = `UPDATE quick_commands SET name = ?, command = ?, variables = ?, updated_at = strftime('%s', 'now') WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const variablesJson = variables ? JSON.stringify(variables) : null;
    const result = await runDb(db, sql, [name, command, variablesJson, id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error('更新快捷指令时出错:', err.message);
    throw ErrorFactory.databaseError('无法更新快捷指令', '无法更新快捷指令');
  }
};

/**
 * 根据 ID 删除指定的快捷指令
 * @param id - 要删除的记录 ID
 * @returns 返回是否成功删除 (true/false)
 */
export const deleteQuickCommand = async (id: number): Promise<boolean> => {
  const sql = `DELETE FROM quick_commands WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error('删除快捷指令时出错:', err.message);
    throw ErrorFactory.databaseError('无法删除快捷指令', '无法删除快捷指令');
  }
};

/**
 * 获取所有快捷指令及其关联的标签 ID
 * @param sortBy - 排序字段 ('name' 或 'usage_count')
 * @returns 返回包含所有快捷指令条目及标签 ID 的数组
 */
export const getAllQuickCommands = async (
  sortBy: 'name' | 'usage_count' = 'name'
): Promise<QuickCommandWithTags[]> => {
  // P1-4: 显式 allowlist 验证（纵深防御）
  const ALLOWED_SORT_COLUMNS: Array<'name' | 'usage_count'> = ['name', 'usage_count'];
  if (!ALLOWED_SORT_COLUMNS.includes(sortBy)) {
    throw ErrorFactory.validationError(
      `无效的排序字段: ${sortBy}`,
      `field: sortBy, value: ${sortBy}, allowed: ${ALLOWED_SORT_COLUMNS.join(', ')}`
    );
  }

  let orderByClause = 'ORDER BY qc.name ASC'; // 默认按名称升序
  if (sortBy === 'usage_count') {
    orderByClause = 'ORDER BY qc.usage_count DESC, qc.name ASC'; // 按使用频率降序，同频率按名称升序
  }
  // 使用 LEFT JOIN 连接关联表，并使用 GROUP_CONCAT 获取标签 ID 字符串
  const sql = `
        SELECT
            qc.id, qc.name, qc.command, qc.usage_count, qc.variables, qc.created_at, qc.updated_at,
            GROUP_CONCAT(qta.tag_id) as tag_ids_str
         FROM quick_commands qc
         LEFT JOIN quick_command_tag_associations qta ON qc.id = qta.quick_command_id
         GROUP BY qc.id
         ${orderByClause}`;
  try {
    const db = await getDbInstance();
    const rows = await allDb<DbQuickCommandWithTagsRow>(db, sql);
    // 将 tag_ids_str 解析为数字数组，并解析 variables
    return rows.map((row) => {
      let parsedVariables: Record<string, string> | null = null;
      if (row.variables) {
        try {
          parsedVariables = JSON.parse(row.variables);
        } catch (e) {
          console.error(`Error parsing variables for quick command ${row.id}:`, e);
          // 保持 parsedVariables 为 null
        }
      }
      const { variables, ...restOfRow } = row; // 从 row 中移除原始的 string 类型的 variables
      return {
        ...restOfRow,
        variables: parsedVariables,
        tagIds: row.tag_ids_str
          ? row.tag_ids_str
              .split(',')
              .map(Number)
              .filter((id) => !isNaN(id))
          : [],
      };
    });
  } catch (err: any) {
    console.error('获取快捷指令（带标签）时出错:', err.message);
    throw ErrorFactory.databaseError('无法获取快捷指令', '无法获取快捷指令');
  }
};

/**
 * 增加指定快捷指令的使用次数
 * @param id - 要增加次数的记录 ID
 * @returns 返回是否成功更新 (true/false)
 */
export const incrementUsageCount = async (id: number): Promise<boolean> => {
  const sql = `UPDATE quick_commands SET usage_count = usage_count + 1, updated_at = strftime('%s', 'now') WHERE id = ?`;
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error('增加快捷指令使用次数时出错:', err.message);
    throw ErrorFactory.databaseError('无法增加快捷指令使用次数', '无法增加快捷指令使用次数');
  }
};

/**
 * 根据 ID 查找快捷指令及其关联的标签 ID
 * @param id - 要查找的记录 ID
 * @returns 返回找到的快捷指令条目及标签 ID，如果未找到则返回 undefined
 */
export const findQuickCommandById = async (
  id: number
): Promise<QuickCommandWithTags | undefined> => {
  // 使用 LEFT JOIN 连接关联表，并使用 GROUP_CONCAT 获取标签 ID 字符串
  const sql = `
        SELECT
            qc.id, qc.name, qc.command, qc.usage_count, qc.variables, qc.created_at, qc.updated_at,
            GROUP_CONCAT(qta.tag_id) as tag_ids_str
         FROM quick_commands qc
         LEFT JOIN quick_command_tag_associations qta ON qc.id = qta.quick_command_id
         WHERE qc.id = ?
         GROUP BY qc.id`;
  try {
    const db = await getDbInstance();
    const row = await getDbRow<DbQuickCommandWithTagsRow>(db, sql, [id]);
    if (row && typeof row.id !== 'undefined') {
      // 将 tag_ids_str 解析为数字数组，并解析 variables
      let parsedVariables: Record<string, string> | null = null;
      if (row.variables) {
        try {
          parsedVariables = JSON.parse(row.variables);
        } catch (e) {
          console.error(`Error parsing variables for quick command ${row.id}:`, e);
          // 保持 parsedVariables 为 null
        }
      }
      const { variables, ...restOfRow } = row; // 从 row 中移除原始的 string 类型的 variables
      return {
        ...restOfRow,
        variables: parsedVariables,
        tagIds: row.tag_ids_str
          ? row.tag_ids_str
              .split(',')
              .map(Number)
              .filter((id) => !isNaN(id))
          : [],
      };
    }
    return undefined;
  } catch (err: any) {
    console.error('查找快捷指令（带标签）时出错:', err.message);
    throw ErrorFactory.databaseError('无法查找快捷指令', '无法查找快捷指令');
  }
};
