// packages/frontend/src/types/terminal-theme.types.ts
import type { ITheme } from 'xterm';

// 前端使用的终端主题结构 (对应 API 响应)
export interface TerminalTheme {
  // 注意：前端可能不需要 _id, createdAt, updatedAt 等数据库相关的字段
  // 但为了与后端导入保持一致，暂时保留，后续可根据 API 精简
  _id?: string; // NeDB ID (前端通常不直接使用)
  name: string;
  themeData: ITheme;
  isPreset: boolean;
  isSystemDefault?: boolean;
}
