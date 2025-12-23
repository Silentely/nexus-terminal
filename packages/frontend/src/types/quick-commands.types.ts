// packages/frontend/src/types/quick-commands.types.ts

// 前端使用的快捷指令结构 (对应 API 响应)
export interface QuickCommand {
  id: number;
  name: string | null;
  command: string;
  usage_count: number;
  created_at: number; // Unix 时间戳 (秒)
  updated_at: number; // Unix 时间戳 (秒)
}
