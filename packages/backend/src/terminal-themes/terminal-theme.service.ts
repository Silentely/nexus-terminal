import type { ITheme } from 'xterm';
import * as terminalThemeRepository from './terminal-theme.repository';
import {
  TerminalTheme,
  CreateTerminalThemeDto,
  UpdateTerminalThemeDto,
} from '../types/terminal-theme.types';

/**
 * 获取所有终端主题
 * @returns Promise<TerminalTheme[]>
 */
export const getAllThemes = async (): Promise<TerminalTheme[]> => {
  return terminalThemeRepository.findAllThemes();
};

/**
 * 根据 ID 获取单个终端主题
 * @param id 主题 ID (SQLite 数字 ID)
 * @returns Promise<TerminalTheme | null>
 */
export const getThemeById = async (id: number): Promise<TerminalTheme | null> => {
  if (Number.isNaN(id)) {
    throw new Error('无效的主题 ID');
  }
  return terminalThemeRepository.findThemeById(id);
};

/**
 * 创建新终端主题
 * @param themeDto 创建数据
 * @returns Promise<TerminalTheme>
 */
export const createNewTheme = async (themeDto: CreateTerminalThemeDto): Promise<TerminalTheme> => {
  // 移除验证相关的注释
  // 简单验证 themeData 结构 (确保基本字段存在)
  if (
    !themeDto.themeData ||
    typeof themeDto.themeData.background !== 'string' ||
    typeof themeDto.themeData.foreground !== 'string'
  ) {
    throw new Error('无效的主题数据格式');
  }

  return terminalThemeRepository.createTheme(themeDto);
};

/**
 * 更新终端主题
 * @param id 主题 ID (SQLite 数字 ID)
 * @param themeDto 更新数据
 * @returns Promise<boolean> 是否成功更新
 */
export const updateExistingTheme = async (
  id: number,
  themeDto: UpdateTerminalThemeDto
): Promise<boolean> => {
  if (Number.isNaN(id)) {
    throw new Error('无效的主题 ID');
  }
  // 可选：验证 themeDto
  if (
    !themeDto.name ||
    !themeDto.themeData ||
    typeof themeDto.themeData.background !== 'string' ||
    typeof themeDto.themeData.foreground !== 'string'
  ) {
    throw new Error('无效的主题更新数据');
  }
  return terminalThemeRepository.updateTheme(id, themeDto);
};

/**
 * 删除终端主题
 * @param id 主题 ID (SQLite 数字 ID)
 * @returns Promise<boolean> 是否成功删除
 */
export const deleteExistingTheme = async (id: number): Promise<boolean> => {
  if (Number.isNaN(id)) {
    throw new Error('无效的主题 ID');
  }
  return terminalThemeRepository.deleteTheme(id);
};

/**
 * 导入终端主题
 * @param themeData 主题数据对象 (ITheme)
 * @param name 主题名称
 * @returns Promise<TerminalTheme>
 */
export const importTheme = async (themeData: ITheme, name: string): Promise<TerminalTheme> => {
  if (!name) {
    throw new Error('导入主题时必须提供名称');
  }
  // 验证导入的数据结构是否符合 ITheme (简化验证)
  if (typeof themeData.background !== 'string' || typeof themeData.foreground !== 'string') {
    throw new Error('导入的主题数据格式无效');
  }
  const dto: CreateTerminalThemeDto = { name, themeData };
  return createNewTheme(dto);
};
