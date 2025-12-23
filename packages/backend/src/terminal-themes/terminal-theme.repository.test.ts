/**
 * Terminal Theme Repository 单元测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock 数据库连接
vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn().mockResolvedValue({ changes: 1, lastID: 1 }),
  getDb: vi.fn(),
  allDb: vi.fn().mockResolvedValue([]),
}));

import { getDbInstance, runDb, getDb, allDb } from '../database/connection';
import {
  findAllThemes,
  findThemeById,
  createTheme,
  updateTheme,
  deleteTheme,
} from './terminal-theme.repository';

describe('Terminal Theme Repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  const mockDbRow = {
    id: 1,
    name: 'Dark Theme',
    theme_type: 'user' as const,
    foreground: '#ffffff',
    background: '#000000',
    cursor: '#00ff00',
    cursor_accent: null,
    selection_background: '#333333',
    black: '#000000',
    red: '#ff0000',
    green: '#00ff00',
    yellow: '#ffff00',
    blue: '#0000ff',
    magenta: '#ff00ff',
    cyan: '#00ffff',
    white: '#ffffff',
    bright_black: '#666666',
    bright_red: '#ff6666',
    bright_green: '#66ff66',
    bright_yellow: '#ffff66',
    bright_blue: '#6666ff',
    bright_magenta: '#ff66ff',
    bright_cyan: '#66ffff',
    bright_white: '#ffffff',
    created_at: 1000,
    updated_at: 1000,
  };

  describe('findAllThemes', () => {
    it('应返回所有终端主题', async () => {
      (allDb as any).mockResolvedValueOnce([mockDbRow]);

      const result = await findAllThemes();

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('1');
      expect(result[0].name).toBe('Dark Theme');
      expect(result[0].isPreset).toBe(false);
      expect(result[0].themeData.foreground).toBe('#ffffff');
    });

    it('应正确识别预设主题', async () => {
      const presetRow = { ...mockDbRow, theme_type: 'preset' as const };
      (allDb as any).mockResolvedValueOnce([presetRow]);

      const result = await findAllThemes();

      expect(result[0].isPreset).toBe(true);
    });

    it('应正确识别系统默认主题', async () => {
      const defaultRow = { ...mockDbRow, name: 'default' };
      (allDb as any).mockResolvedValueOnce([defaultRow]);

      const result = await findAllThemes();

      expect(result[0].isSystemDefault).toBe(true);
    });

    it('无主题时应返回空数组', async () => {
      (allDb as any).mockResolvedValueOnce([]);

      const result = await findAllThemes();

      expect(result).toHaveLength(0);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findAllThemes()).rejects.toThrow('查询终端主题失败');
    });
  });

  describe('findThemeById', () => {
    it('应返回指定 ID 的主题', async () => {
      (getDb as any).mockResolvedValueOnce(mockDbRow);

      const result = await findThemeById(1);

      expect(result).not.toBeNull();
      expect(result?._id).toBe('1');
      expect(result?.name).toBe('Dark Theme');
    });

    it('主题不存在时应返回 null', async () => {
      (getDb as any).mockResolvedValueOnce(null);

      const result = await findThemeById(999);

      expect(result).toBeNull();
    });

    it('无效 ID 应返回 null', async () => {
      const result = await findThemeById(NaN);
      expect(result).toBeNull();

      const result2 = await findThemeById(-1);
      expect(result2).toBeNull();
    });

    it('数据库错误时应抛出异常', async () => {
      (getDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(findThemeById(1)).rejects.toThrow('查询终端主题失败');
    });
  });

  describe('createTheme', () => {
    it('应成功创建主题并返回完整数据', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });
      (getDb as any).mockResolvedValueOnce({ ...mockDbRow, id: 5 });

      const result = await createTheme({
        name: 'New Theme',
        themeData: {
          foreground: '#ffffff',
          background: '#000000',
        },
      });

      expect(result._id).toBe('5');
      expect(runDb).toHaveBeenCalled();
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('INSERT INTO terminal_themes');
    });

    it('lastID 无效时应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 0, changes: 0 });

      await expect(
        createTheme({
          name: 'Test',
          themeData: { foreground: '#fff', background: '#000' },
        })
      ).rejects.toThrow('创建终端主题失败');
    });

    it('创建后无法检索到主题应抛出异常', async () => {
      (runDb as any).mockResolvedValueOnce({ lastID: 5, changes: 1 });
      (getDb as any).mockResolvedValueOnce(null);

      await expect(
        createTheme({
          name: 'Test',
          themeData: { foreground: '#fff', background: '#000' },
        })
      ).rejects.toThrow('创建终端主题失败');
    });

    it('主题名称重复时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(
        createTheme({
          name: 'Duplicate',
          themeData: { foreground: '#fff', background: '#000' },
        })
      ).rejects.toThrow('主题名称 "Duplicate" 已存在');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Some database error'));

      await expect(
        createTheme({
          name: 'Test',
          themeData: { foreground: '#fff', background: '#000' },
        })
      ).rejects.toThrow('创建终端主题失败');
    });
  });

  describe('updateTheme', () => {
    it('应成功更新用户主题', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await updateTheme(1, {
        name: 'Updated Theme',
        themeData: { foreground: '#fff', background: '#000' },
      });

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain('UPDATE terminal_themes');
      expect(call[1]).toContain("theme_type = 'user'"); // 只能更新用户主题
    });

    it('预设主题或不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await updateTheme(999, {
        name: 'Test',
        themeData: { foreground: '#fff', background: '#000' },
      });

      expect(result).toBe(false);
    });

    it('主题名称重复时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('UNIQUE constraint failed'));

      await expect(
        updateTheme(1, {
          name: 'Duplicate',
          themeData: { foreground: '#fff', background: '#000' },
        })
      ).rejects.toThrow('主题名称 "Duplicate" 已存在');
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(
        updateTheme(1, {
          name: 'Test',
          themeData: { foreground: '#fff', background: '#000' },
        })
      ).rejects.toThrow('更新终端主题失败');
    });
  });

  describe('deleteTheme', () => {
    it('应成功删除用户主题', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 1 });

      const result = await deleteTheme(1);

      expect(result).toBe(true);
      const call = (runDb as any).mock.calls[0];
      expect(call[1]).toContain("DELETE FROM terminal_themes WHERE id = ? AND theme_type = 'user'");
    });

    it('预设主题或不存在时应返回 false', async () => {
      (runDb as any).mockResolvedValueOnce({ changes: 0 });

      const result = await deleteTheme(999);

      expect(result).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('Database error'));

      await expect(deleteTheme(1)).rejects.toThrow('删除终端主题失败');
    });
  });
});
