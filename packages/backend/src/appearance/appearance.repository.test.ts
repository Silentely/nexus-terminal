import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { runDb, allDb } from '../database/connection';
import { findThemeById } from '../terminal-themes/terminal-theme.repository';
import { defaultUiTheme } from '../config/default-themes';
import { getAppearanceSettings, updateAppearanceSettings } from './appearance.repository';

vi.mock('../database/connection', () => ({
  getDbInstance: vi.fn().mockResolvedValue({}),
  runDb: vi.fn(),
  getDb: vi.fn(),
  allDb: vi.fn(),
}));

vi.mock('../terminal-themes/terminal-theme.repository', () => ({
  findThemeById: vi.fn(),
}));

describe('appearance.repository', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetAllMocks();
  });

  describe('getAppearanceSettings', () => {
    it('无数据库记录时应返回默认值', async () => {
      (allDb as any).mockResolvedValueOnce([]);
      const settings = await getAppearanceSettings();
      expect(settings._id).toBe('global_appearance');
      expect(settings.customUiTheme).toBe(JSON.stringify(defaultUiTheme));
      expect(settings.terminalBackgroundEnabled).toBe(true);
      expect(settings.terminalBackgroundOverlayOpacity).toBe(0.5);
      expect(settings.activeTerminalThemeId).toBeNull();
    });

    it('数据库中存在 terminalBackgroundEnabled=false 时应使用该值', async () => {
      (allDb as any).mockResolvedValueOnce([
        { key: 'terminalBackgroundEnabled', value: 'false', updated_at: 1 },
      ]);
      const settings = await getAppearanceSettings();
      expect(settings.terminalBackgroundEnabled).toBe(false);
    });

    it('数据库错误时应抛出异常', async () => {
      (allDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(getAppearanceSettings()).rejects.toThrow('获取外观设置失败');
    });
  });

  describe('updateAppearanceSettings', () => {
    it('activeTerminalThemeId 指向不存在主题时应抛出异常', async () => {
      (findThemeById as any).mockResolvedValueOnce(null);
      await expect(updateAppearanceSettings({ activeTerminalThemeId: 123 } as any)).rejects.toThrow(
        '验证主题失败'
      );
    });

    it('应将 remoteHtmlPresetsUrl 映射为 remote_html_presets_url 并写入数据库', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      (runDb as any).mockResolvedValue({ changes: 1 });

      const ok = await updateAppearanceSettings({
        remoteHtmlPresetsUrl: 'https://github.com/u/r/tree/main/themes',
        terminalBackgroundEnabled: false,
      } as any);

      expect(ok).toBe(true);
      const calls = (runDb as any).mock.calls.map((c: any[]) => c[2]);
      const keys = calls.map((args: any[]) => args[0]);
      const values = calls.map((args: any[]) => args[1]);
      expect(keys).toContain('remote_html_presets_url');
      expect(values).toContain('https://github.com/u/r/tree/main/themes');
      expect(keys).toContain('terminalBackgroundEnabled');
      expect(values).toContain('false');
    });

    it('activeTerminalThemeId 显式为 null 时应写入 \"null\" 且不触发主题校验', async () => {
      vi.spyOn(Date, 'now').mockReturnValue(1700000000000);
      (runDb as any).mockResolvedValue({ changes: 1 });

      const ok = await updateAppearanceSettings({ activeTerminalThemeId: null } as any);
      expect(ok).toBe(true);
      expect(findThemeById).not.toHaveBeenCalled();

      const call = (runDb as any).mock.calls[0];
      expect(call[2][0]).toBe('activeTerminalThemeId');
      expect(call[2][1]).toBe('null');
    });

    it('数据库写入错误时应抛出异常', async () => {
      (runDb as any).mockRejectedValueOnce(new Error('db error'));
      await expect(updateAppearanceSettings({ terminalFontSize: 12 } as any)).rejects.toThrow(
        '更新外观设置失败'
      );
    });
  });
});
