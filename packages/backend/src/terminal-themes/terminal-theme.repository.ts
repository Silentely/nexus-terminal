import { Database } from 'sqlite3';
import { ErrorFactory } from '../utils/AppError';
import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import {
  TerminalTheme,
  CreateTerminalThemeDto,
  UpdateTerminalThemeDto,
} from '../types/terminal-theme.types';

interface DbTerminalThemeRow {
  id: number;
  name: string;
  theme_type: 'preset' | 'user';
  foreground?: string | null;
  background?: string | null;
  cursor?: string | null;
  cursor_accent?: string | null;
  selection_background?: string | null;
  black?: string | null;
  red?: string | null;
  green?: string | null;
  yellow?: string | null;
  blue?: string | null;
  magenta?: string | null;
  cyan?: string | null;
  white?: string | null;
  bright_black?: string | null;
  bright_red?: string | null;
  bright_green?: string | null;
  bright_yellow?: string | null;
  bright_blue?: string | null;
  bright_magenta?: string | null;
  bright_cyan?: string | null;
  bright_white?: string | null;
  created_at: number;
  updated_at: number;
}

// 辅助函数：将数据库行转换为 TerminalTheme 对象
const mapRowToTerminalTheme = (row: DbTerminalThemeRow): TerminalTheme => {
  // Basic check if row exists and has id property
  if (!row || typeof row.id === 'undefined') {
    console.error('mapRowToTerminalTheme received invalid row:', row);
    throw ErrorFactory.databaseError('Invalid database row provided to mapRowToTerminalTheme', 'Invalid database row provided to mapRowToTerminalTheme');
  }
  try {
    return {
      _id: row.id.toString(),
      name: row.name,
      themeData: {
        foreground: row.foreground ?? undefined,
        background: row.background ?? undefined,
        cursor: row.cursor ?? undefined,
        cursorAccent: row.cursor_accent ?? undefined,
        selectionBackground: row.selection_background ?? undefined,
        black: row.black ?? undefined,
        red: row.red ?? undefined,
        green: row.green ?? undefined,
        yellow: row.yellow ?? undefined,
        blue: row.blue ?? undefined,
        magenta: row.magenta ?? undefined,
        cyan: row.cyan ?? undefined,
        white: row.white ?? undefined,
        brightBlack: row.bright_black ?? undefined,
        brightRed: row.bright_red ?? undefined,
        brightGreen: row.bright_green ?? undefined,
        brightYellow: row.bright_yellow ?? undefined,
        brightBlue: row.bright_blue ?? undefined,
        brightMagenta: row.bright_magenta ?? undefined,
        brightCyan: row.bright_cyan ?? undefined,
        brightWhite: row.bright_white ?? undefined,
      },
      isPreset: row.theme_type === 'preset',
      isSystemDefault: row.name === 'default',
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (e: any) {
    console.error(`Error mapping theme data for theme ID ${row.id}:`, e.message, 'Raw row:', row);
    throw ErrorFactory.databaseError(
      '主题数据映射失败',
      `Failed to map theme data for theme ID ${row.id}: ${e.message}`
    );
  }
};

/**
 * 查找所有终端主题
 * @returns Promise<TerminalTheme[]>
 */
export const findAllThemes = async (): Promise<TerminalTheme[]> => {
  try {
    const db = await getDbInstance();
    const rows = await allDb<DbTerminalThemeRow>(
      db,
      "SELECT * FROM terminal_themes ORDER BY CASE theme_type WHEN 'preset' THEN 0 ELSE 1 END ASC, name ASC"
    );
    return rows
      .map((row) => {
        try {
          return mapRowToTerminalTheme(row);
        } catch (mapError: any) {
          console.error(`Error mapping row ID ${row?.id}:`, mapError.message);
          return null;
        }
      })
      .filter((theme): theme is TerminalTheme => theme !== null);
  } catch (err: any) {
    console.error('查询所有终端主题失败:', err.message);
    // 添加详细错误日志
    console.error('详细错误:', err);
    throw ErrorFactory.databaseError('查询终端主题失败', '查询终端主题失败');
  }
};

/**
 * 根据 ID 查找终端主题
 * @param id 主题 ID (SQLite 数字 ID)
 * @returns Promise<TerminalTheme | null>
 */
export const findThemeById = async (id: number): Promise<TerminalTheme | null> => {
  if (isNaN(id) || id <= 0) {
    console.error('findThemeById called with invalid ID:', id);
    return null;
  }
  try {
    const db = await getDbInstance();
    const row = await getDb<DbTerminalThemeRow>(db, 'SELECT * FROM terminal_themes WHERE id = ?', [
      id,
    ]);
    return row ? mapRowToTerminalTheme(row) : null;
  } catch (err: any) {
    console.error(`查询 ID 为 ${id} 的终端主题失败:`, err.message);
    throw ErrorFactory.databaseError('查询终端主题失败', '查询终端主题失败');
  }
};

/**
 * 创建一个新的终端主题
 * @param themeDto 创建主题所需的数据
 * @returns Promise<TerminalTheme> 新创建的主题
 */
export const createTheme = async (themeDto: CreateTerminalThemeDto): Promise<TerminalTheme> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const theme = themeDto.themeData;

  const columns = [
    'name',
    'theme_type',
    'foreground',
    'background',
    'cursor',
    'cursor_accent',
    'selection_background',
    'black',
    'red',
    'green',
    'yellow',
    'blue',
    'magenta',
    'cyan',
    'white',
    'bright_black',
    'bright_red',
    'bright_green',
    'bright_yellow',
    'bright_blue',
    'bright_magenta',
    'bright_cyan',
    'bright_white',
    'created_at',
    'updated_at',
  ];
  const values = [
    themeDto.name,
    'user',
    theme?.foreground ?? null,
    theme?.background ?? null,
    theme?.cursor ?? null,
    theme?.cursorAccent ?? null,
    theme?.selectionBackground ?? null,
    theme?.black ?? null,
    theme?.red ?? null,
    theme?.green ?? null,
    theme?.yellow ?? null,
    theme?.blue ?? null,
    theme?.magenta ?? null,
    theme?.cyan ?? null,
    theme?.white ?? null,
    theme?.brightBlack ?? null,
    theme?.brightRed ?? null,
    theme?.brightGreen ?? null,
    theme?.brightYellow ?? null,
    theme?.brightBlue ?? null,
    theme?.brightMagenta ?? null,
    theme?.brightCyan ?? null,
    theme?.brightWhite ?? null,
    nowSeconds,
    nowSeconds,
  ];
  const placeholders = columns.map(() => '?').join(', ');

  const sql = `
    INSERT INTO terminal_themes (${columns.join(', ')})
    VALUES (${placeholders})
  `;

  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, values);
    if (typeof result.lastID !== 'number' || result.lastID <= 0) {
      throw ErrorFactory.databaseError('创建主题后未能获取有效的 lastID', '创建主题后未能获取有效的 lastID');
    }
    const newTheme = await findThemeById(result.lastID);
    if (newTheme) {
      return newTheme;
    }
    throw ErrorFactory.databaseError(
      '创建主题失败',
      `创建主题后未能检索到 ID 为 ${result.lastID} 的主题`
    );
  } catch (err: any) {
    console.error('创建新终端主题失败:', err.message);
    if (err.message.includes('UNIQUE constraint failed')) {
      throw ErrorFactory.validationError(`主题名称 "${themeDto.name}" 已存在`, `field: name, value: ${themeDto.name}`);
    } else {
      throw ErrorFactory.databaseError('创建终端主题失败', `创建终端主题失败: ${err.message}`);
    }
  }
};

/**
 * 更新一个终端主题
 * @param id 要更新的主题 ID (SQLite 数字 ID)
 * @param themeDto 更新的数据
 * @returns Promise<boolean> 是否成功更新
 */
export const updateTheme = async (
  id: number,
  themeDto: UpdateTerminalThemeDto
): Promise<boolean> => {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const theme = themeDto.themeData;

  const setClauses = [
    'name = ?',
    'foreground = ?',
    'background = ?',
    'cursor = ?',
    'cursor_accent = ?',
    'selection_background = ?',
    'black = ?',
    'red = ?',
    'green = ?',
    'yellow = ?',
    'blue = ?',
    'magenta = ?',
    'cyan = ?',
    'white = ?',
    'bright_black = ?',
    'bright_red = ?',
    'bright_green = ?',
    'bright_yellow = ?',
    'bright_blue = ?',
    'bright_magenta = ?',
    'bright_cyan = ?',
    'bright_white = ?',
    'updated_at = ?',
  ];

  const values = [
    themeDto.name,
    theme?.foreground ?? null,
    theme?.background ?? null,
    theme?.cursor ?? null,
    theme?.cursorAccent ?? null,
    theme?.selectionBackground ?? null,
    theme?.black ?? null,
    theme?.red ?? null,
    theme?.green ?? null,
    theme?.yellow ?? null,
    theme?.blue ?? null,
    theme?.magenta ?? null,
    theme?.cyan ?? null,
    theme?.white ?? null,
    theme?.brightBlack ?? null,
    theme?.brightRed ?? null,
    theme?.brightGreen ?? null,
    theme?.brightYellow ?? null,
    theme?.brightBlue ?? null,
    theme?.brightMagenta ?? null,
    theme?.brightCyan ?? null,
    theme?.brightWhite ?? null,
    nowSeconds,
    id, // For WHERE clause
  ];

  const sql = `
    UPDATE terminal_themes
    SET ${setClauses.join(', ')}
    WHERE id = ? AND theme_type = 'user'
  `;

  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, values);
    return result.changes > 0;
  } catch (err: any) {
    console.error(`更新 ID 为 ${id} 的终端主题失败:`, err.message);
    if (err.message.includes('UNIQUE constraint failed')) {
      throw ErrorFactory.validationError(`主题名称 "${themeDto.name}" 已存在`, `field: name, value: ${themeDto.name}`);
    } else {
      throw ErrorFactory.databaseError('更新终端主题失败', `更新终端主题失败: ${err.message}`);
    }
  }
};

/**
 * 删除一个终端主题
 * @param id 要删除的主题 ID (SQLite 数字 ID)
 * @returns Promise<boolean> 是否成功删除
 */
export const deleteTheme = async (id: number): Promise<boolean> => {
  const sql = "DELETE FROM terminal_themes WHERE id = ? AND theme_type = 'user'";
  try {
    const db = await getDbInstance();
    const result = await runDb(db, sql, [id]);
    return result.changes > 0;
  } catch (err: any) {
    console.error(`删除 ID 为 ${id} 的终端主题失败:`, err.message);
    throw ErrorFactory.databaseError('删除终端主题失败', '删除终端主题失败');
  }
};

/**
 * 初始化预设主题到数据库 (如果不存在)
 * 这个函数应该在数据库连接成功后，由应用初始化逻辑调用。
 * @param presets 预设主题定义数组
 */
export const initializePresetThemes = async (
  db: Database,
  presets: Array<
    Omit<TerminalTheme, '_id' | 'createdAt' | 'updatedAt' | 'isSystemDefault'> & { name: string }
  >
) => {
  console.log('[DB Init] 开始检查并初始化预设主题...');
  // 在这里添加日志，显示总共要处理多少个预设主题
  console.log(`[DB Init] 发现 ${presets.length} 个预设主题定义。`);
  const nowSeconds = Math.floor(Date.now() / 1000);

  for (const preset of presets) {
    // 在循环开始时添加日志，显示正在处理哪个主题
    // console.log(`[DB Init] 正在处理预设主题: "${preset.name}"`);
    try {
      const existing = await getDb<{ id: number }>(
        db,
        `SELECT id FROM terminal_themes WHERE name = ? AND theme_type = 'preset'`,
        [preset.name]
      );

      if (!existing) {
        const theme = preset.themeData;
        const columns = [
          'name',
          'theme_type',
          'foreground',
          'background',
          'cursor',
          'cursor_accent',
          'selection_background',
          'black',
          'red',
          'green',
          'yellow',
          'blue',
          'magenta',
          'cyan',
          'white',
          'bright_black',
          'bright_red',
          'bright_green',
          'bright_yellow',
          'bright_blue',
          'bright_magenta',
          'bright_cyan',
          'bright_white',
          'created_at',
          'updated_at',
        ];
        const values = [
          preset.name,
          'preset',
          theme?.foreground,
          theme?.background,
          theme?.cursor,
          theme?.cursorAccent,
          theme?.selectionBackground,
          theme?.black,
          theme?.red,
          theme?.green,
          theme?.yellow,
          theme?.blue,
          theme?.magenta,
          theme?.cyan,
          theme?.white,
          theme?.brightBlack,
          theme?.brightRed,
          theme?.brightGreen,
          theme?.brightYellow,
          theme?.brightBlue,
          theme?.brightMagenta,
          theme?.brightCyan,
          theme?.brightWhite,
          nowSeconds,
          nowSeconds,
        ];
        const placeholders = columns.map(() => '?').join(', ');

        const insertSql = `
                    INSERT INTO terminal_themes (${columns.join(', ')})
                    VALUES (${placeholders})
                `;
        await runDb(db, insertSql, values);
        // console.log(`[DB Init] 预设主题 "${preset.name}" 已初始化到数据库。`);
      } else {
        //  console.log(`[DB Init] 预设主题 "${preset.name}" 已存在，跳过初始化。`);
      }
    } catch (err: any) {
      console.error(`[DB Init] 处理预设主题 "${preset.name}" 时出错:`, err.message);
    }
  }
  console.log('[DB Init] 预设主题检查和初始化完成。');
};
