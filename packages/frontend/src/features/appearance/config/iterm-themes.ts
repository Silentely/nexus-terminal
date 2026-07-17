// 精简样例主题集（用于单元测试与类型校验）
// 完整 iTerm 预设由后端 packages/backend/src/config/preset-themes-definition.ts
// 在数据库初始化时写入，前端通过 /terminal-themes API 拉取，不再打包本机巨型静态表。
// 历史全量生成文件已移除，避免 ~300KB 无效前端源码与测试耗时。
import type { TerminalTheme } from '../../../types/terminal-theme.types';

export const Theme_DefaultDarkPreset: TerminalTheme = {
  _id: 'preset-default-dark',
  name: 'Default Dark',
  isPreset: true,
  themeData: {
    foreground: '#d4d4d4',
    background: '#1e1e1e',
    cursor: '#d4d4d4',
    cursorAccent: '#000000',
    selectionBackground: '#264f78',
    selectionForeground: '#ffffff',
    black: '#000000',
    red: '#cd3131',
    green: '#0dbc79',
    yellow: '#e5e510',
    blue: '#2472c8',
    magenta: '#bc3fbc',
    cyan: '#11a8cd',
    white: '#e5e5e5',
    brightBlack: '#666666',
    brightRed: '#f14c4c',
    brightGreen: '#23d18b',
    brightYellow: '#f5f543',
    brightBlue: '#3b8eea',
    brightMagenta: '#d670d6',
    brightCyan: '#29b8db',
    brightWhite: '#e5e5e5',
  },
};

export const Theme_DefaultLightPreset: TerminalTheme = {
  _id: 'preset-default-light',
  name: 'Default Light',
  isPreset: true,
  themeData: {
    foreground: '#333333',
    background: '#ffffff',
    cursor: '#333333',
    cursorAccent: '#ffffff',
    selectionBackground: '#add6ff',
    selectionForeground: '#000000',
    black: '#000000',
    red: '#cd3131',
    green: '#00bc00',
    yellow: '#949800',
    blue: '#0451a5',
    magenta: '#bc05bc',
    cyan: '#0598bc',
    white: '#555555',
    brightBlack: '#666666',
    brightRed: '#cd3131',
    brightGreen: '#14ce14',
    brightYellow: '#b5ba00',
    brightBlue: '#0451a5',
    brightMagenta: '#bc05bc',
    brightCyan: '#0598bc',
    brightWhite: '#a5a5a5',
  },
};

export const Theme_SolarizedDarkPreset: TerminalTheme = {
  _id: 'preset-solarized-dark',
  name: 'Solarized Dark',
  isPreset: true,
  themeData: {
    foreground: '#839496',
    background: '#002b36',
    cursor: '#839496',
    cursorAccent: '#002b36',
    selectionBackground: '#073642',
    selectionForeground: '#93a1a1',
    black: '#073642',
    red: '#dc322f',
    green: '#859900',
    yellow: '#b58900',
    blue: '#268bd2',
    magenta: '#d33682',
    cyan: '#2aa198',
    white: '#eee8d5',
    brightBlack: '#002b36',
    brightRed: '#cb4b16',
    brightGreen: '#586e75',
    brightYellow: '#657b83',
    brightBlue: '#839496',
    brightMagenta: '#6c71c4',
    brightCyan: '#93a1a1',
    brightWhite: '#fdf6e3',
  },
};

/** 前端本地样例预设（非运行时主数据源） */
export const presetTerminalThemes: TerminalTheme[] = [
  Theme_DefaultDarkPreset,
  Theme_DefaultLightPreset,
  Theme_SolarizedDarkPreset,
];
