/**
 * 批量执行纯函数工具
 * 命令清洗、包装与 shell 参数转义（复用全局 shellEscape）
 */
import { shellEscape } from '../utils/shell-escape';
import type { BatchExecPayload } from './batch.types';

/**
 * 危险注入模式：仅拦截真正风险向量，允许管道/逻辑运算符等合法 shell 语法
 * - 反引号 / $() / ${} / $'...'
 * - 换行、空字节
 * - 花括号展开 {a,b}
 */
export const DANGEROUS_CMD_PATTERN = /`|\$\(|\$\{|\$'|\n|\r|\x00|\{[a-zA-Z]/;

/**
 * 校验批量执行命令，拒绝注入风险输入；空或非法返回空串
 */
export function sanitizeBatchCommand(command: string): string {
  if (!command || typeof command !== 'string') {
    return '';
  }
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return '';
  }
  if (DANGEROUS_CMD_PATTERN.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * 按 env → sudo → workdir 顺序包装命令
 * 最终形态：cd workdir && sudo -n env VAR=... cmd
 */
export function buildBatchCommand(command: string, payload: BatchExecPayload): string {
  let fullCommand = command;

  if (payload.env && Object.keys(payload.env).length > 0) {
    const envPrefix = Object.entries(payload.env)
      .map(([key, value]) => `${key}=${shellEscape(value)}`)
      .join(' ');
    fullCommand = `env ${envPrefix} ${fullCommand}`;
  }

  if (payload.sudo) {
    fullCommand = `sudo -n ${fullCommand}`;
  }

  if (payload.workdir) {
    fullCommand = `cd ${shellEscape(payload.workdir)} && ${fullCommand}`;
  }

  return fullCommand;
}
