import type { ITheme } from 'xterm';

/**
 * 终端主题数据结构
 */
export interface TerminalTheme {
  _id?: string; // NeDB 自动生成的 ID
  name: string; // 主题名称，例如 "默认", "Solarized Light"
  themeData: ITheme; // xterm.js 的 ITheme 对象
  isPreset: boolean; // 是否为系统预设主题
  isSystemDefault?: boolean; // (可选) 是否为系统默认主题
  createdAt?: number; // 创建时间戳
  updatedAt?: number; // 更新时间戳
}

/**
 * 用于创建新主题的数据结构 (可能不需要 _id, isPreset 等)
 */
export type CreateTerminalThemeDto = Omit<
  TerminalTheme,
  '_id' | 'isPreset' | 'isSystemDefault' | 'createdAt' | 'updatedAt'
>;

/**
 * 用于更新主题的数据结构 (所有字段可选)
 */
export type UpdateTerminalThemeDto = Partial<
  Omit<TerminalTheme, '_id' | 'isPreset' | 'isSystemDefault' | 'createdAt' | 'updatedAt'>
>;
