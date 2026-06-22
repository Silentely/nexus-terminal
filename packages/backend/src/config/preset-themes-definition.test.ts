/**
 * 预设终端主题定义单元测试
 * 验证预设主题数据的完整性和格式正确性
 */
import { describe, it, expect } from 'vitest';
import { presetTerminalThemes } from './preset-themes-definition';

describe('预设终端主题定义', () => {
  it('应导出主题数组', () => {
    expect(Array.isArray(presetTerminalThemes)).toBe(true);
    expect(presetTerminalThemes.length).toBeGreaterThan(0);
  });

  it('每个主题应包含必要的字段', () => {
    for (const theme of presetTerminalThemes) {
      expect(theme).toHaveProperty('preset_key');
      expect(theme).toHaveProperty('name');
      expect(theme).toHaveProperty('isPreset');
      expect(theme).toHaveProperty('themeData');
      expect(typeof theme.preset_key).toBe('string');
      expect(typeof theme.name).toBe('string');
      expect(theme.isPreset).toBe(true);
    }
  });

  it('每个主题的 preset_key 应唯一', () => {
    const keys = presetTerminalThemes.map((t) => t.preset_key);
    const uniqueKeys = new Set(keys);
    expect(uniqueKeys.size).toBe(keys.length);
  });

  it('每个主题的 themeData 应包含所有 16 色和前景/背景色', () => {
    const requiredKeys = [
      'foreground',
      'background',
      'cursor',
      'cursorAccent',
      'selectionBackground',
      'selectionForeground',
      'black',
      'red',
      'green',
      'yellow',
      'blue',
      'magenta',
      'cyan',
      'white',
      'brightBlack',
      'brightRed',
      'brightGreen',
      'brightYellow',
      'brightBlue',
      'brightMagenta',
      'brightCyan',
      'brightWhite',
    ];

    for (const theme of presetTerminalThemes) {
      for (const key of requiredKeys) {
        expect(theme.themeData).toHaveProperty(key);
        expect(typeof (theme.themeData as Record<string, string>)[key]).toBe('string');
      }
    }
  });

  it('每个主题的颜色值应为有效的十六进制颜色', () => {
    const hexColorPattern = /^#[0-9a-fA-F]{6}$/;

    for (const theme of presetTerminalThemes) {
      const themeData = theme.themeData as Record<string, string>;
      for (const [, value] of Object.entries(themeData)) {
        expect(value).toMatch(hexColorPattern);
      }
    }
  });

  it('应包含已知的预设主题', () => {
    const presetKeys = presetTerminalThemes.map((t) => t.preset_key);
    expect(presetKeys).toContain('Dracula');
    expect(presetKeys).toContain('Monokai_Classic');
    expect(presetKeys).toContain('Builtin_Solarized_Dark');
    expect(presetKeys).toContain('Builtin_Solarized_Light');
  });

  it('所有主题名称应为非空字符串', () => {
    for (const theme of presetTerminalThemes) {
      expect(theme.name.trim().length).toBeGreaterThan(0);
    }
  });

  it('所有主题 preset_key 应为非空字符串', () => {
    for (const theme of presetTerminalThemes) {
      expect(theme.preset_key.trim().length).toBeGreaterThan(0);
    }
  });

  it('前景色和背景色不应相同', () => {
    for (const theme of presetTerminalThemes) {
      const themeData = theme.themeData as Record<string, string>;
      expect(themeData.foreground).not.toBe(themeData.background);
    }
  });

  it('cursor 色应为有效的十六进制颜色', () => {
    const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
    for (const theme of presetTerminalThemes) {
      expect(theme.themeData.cursor).toMatch(hexColorPattern);
    }
  });

  it('selectionBackground 色应为有效的十六进制颜色', () => {
    const hexColorPattern = /^#[0-9a-fA-F]{6}$/;
    for (const theme of presetTerminalThemes) {
      expect(theme.themeData.selectionBackground).toMatch(hexColorPattern);
    }
  });

  it('每个主题应恰好有 22 个颜色属性', () => {
    for (const theme of presetTerminalThemes) {
      const keys = Object.keys(theme.themeData);
      expect(keys.length).toBe(22);
    }
  });

  it('bright 颜色应与对应的普通颜色不同（至少部分主题）', () => {
    // 检查至少有一些主题的 bright 颜色与普通颜色不同
    const themesWithDifferentBright = presetTerminalThemes.filter(
      (t) =>
        (t.themeData as Record<string, string>).black !==
        (t.themeData as Record<string, string>).brightBlack,
    );
    expect(themesWithDifferentBright.length).toBeGreaterThan(0);
  });

  it('主题数组应包含超过 50 个预设主题', () => {
    expect(presetTerminalThemes.length).toBeGreaterThan(50);
  });

  it('应包含 Tokyo Night 主题', () => {
    const presetKeys = presetTerminalThemes.map((t) => t.preset_key);
    expect(presetKeys).toContain('tokyonight');
  });

  it('应包含 Atom One Dark 主题', () => {
    const presetKeys = presetTerminalThemes.map((t) => t.preset_key);
    expect(presetKeys).toContain('AtomOneDark');
  });

  it('应包含 Nord 主题', () => {
    const presetKeys = presetTerminalThemes.map((t) => t.preset_key);
    expect(presetKeys).toContain('nord');
  });

  it('应包含 Gruvbox Dark 主题', () => {
    const presetKeys = presetTerminalThemes.map((t) => t.preset_key);
    expect(presetKeys).toContain('GruvboxDark');
  });

  it('所有 isPreset 字段应为 true', () => {
    for (const theme of presetTerminalThemes) {
      expect(theme.isPreset).toBe(true);
    }
  });
});
