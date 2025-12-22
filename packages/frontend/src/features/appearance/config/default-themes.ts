import type { ITheme } from 'xterm';

// 默认 xterm 主题
// (与 backend/src/config/default-themes.ts 中的定义保持一致)
export const defaultXtermTheme: ITheme = {
  background: '#1e1e1e',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78', // 使用 selectionBackground
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
  brightWhite: '#e5e5e5'
};

// 默认 UI 主题 (CSS 变量)
// (与 backend/src/config/default-themes.ts 中的定义保持一致)
export const defaultUiTheme: Record<string, string> = {
  '--app-bg-color': '#ffffff',
  '--text-color': '#333333',
  '--text-color-secondary': '#666666',
  '--border-color': '#cccccc',
  '--link-color': '#8E44AD', // 现代紫色 (Amethyst 变种)
  '--link-hover-color': '#B180E0', // 现代紫色 - 悬停 (更亮)
  '--link-active-color': '#A06CD5', // 现代紫色 - 激活 (基础)
  '--link-active-bg-color': '#F3EBFB', /* 现代紫色 - 激活背景 (非常浅) */
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)', /* Added */
  '--header-bg-color': '#f0f0f0',
  '--footer-bg-color': '#f0f0f0',
  '--button-bg-color': '#A06CD5', // 现代紫色 - 激活 (基础)
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#8E44AD', // 现代紫色 - 悬停 (稍暗)
  '--icon-color': 'var(--text-color-secondary)', // 图标颜色
  '--icon-hover-color': 'var(--link-hover-color)', // 图标悬停颜色 (自动更新)
  '--split-line-color': 'var(--border-color)', /* 分割线颜色 */
  '--split-line-hover-color': 'var(--border-color)', /* 分割线悬停颜色 */
  '--input-focus-border-color': 'var(--link-active-color)', /* 输入框聚焦边框颜色 (自动更新) */
  '--input-focus-glow': 'var(--link-active-color)', /* 输入框聚焦光晕值 (自动更新) */
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.6)', /* Added Overlay Background - 恢复 rgba 以支持透明度 */
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};

export const darkUiTheme: Record<string, string> = {
  '--app-bg-color': '#0f172a', /* Slate 900 */
  '--text-color': '#f8fafc',    /* Slate 50 */
  '--text-color-secondary': '#94a3b8', /* Slate 400 */
  '--border-color': '#1e293b',  /* Slate 800 */
  '--link-color': '#38bdf8',    /* Sky 400 */
  '--link-hover-color': '#7dd3fc', /* Sky 300 */
  '--link-active-color': '#0ea5e9', /* Sky 500 */
  '--link-active-bg-color': 'rgba(14, 165, 233, 0.15)',
  '--nav-item-active-bg-color': 'var(--link-active-bg-color)',
  '--header-bg-color': 'rgba(15, 23, 42, 0.9)', /* Slate 900 semi-transparent */
  '--footer-bg-color': '#0f172a',
  '--button-bg-color': '#0ea5e9', /* Sky 500 */
  '--button-text-color': '#ffffff',
  '--button-hover-bg-color': '#0284c7', /* Sky 600 */
  '--icon-color': 'var(--text-color-secondary)',
  '--icon-hover-color': 'var(--link-hover-color)',
  '--split-line-color': 'var(--border-color)',
  '--split-line-hover-color': 'var(--link-active-color)',
  '--input-focus-border-color': 'var(--link-active-color)',
  '--input-focus-glow': 'var(--link-active-color)',
  '--overlay-bg-color': 'rgba(0, 0, 0, 0.75)',
  '--font-family-sans-serif': 'sans-serif',
  '--base-padding': '1rem',
  '--base-margin': '0.5rem',
};
