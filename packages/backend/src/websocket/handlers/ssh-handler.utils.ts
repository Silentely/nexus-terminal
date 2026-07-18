/**
 * SSH WebSocket handler 纯函数工具
 * 从 ssh.handler 抽出，便于单测与复用（resize 校验、静默执行输出解析、提示符抑制）
 */

/** 静默执行成功判定策略 */
export type SilentExecSuccessCriteria = 'any' | 'non_empty' | 'absolute_path';

/** resize 合法上限（与历史行为一致） */
export const SSH_RESIZE_MAX_COLS = 1000;
export const SSH_RESIZE_MAX_ROWS = 500;

const SILENT_PWD_PREFIX = '__NX_PWD__';
const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const OSC_ESCAPE_PATTERN = /\x1B\][^\x07]*(?:\x07|\x1B\\)/g;

const UNIX_PROMPT_CORE_PATTERN = '[^@\\s]+@[^:\\s]+:[^#$>\\n]*[#$>]';
const WINDOWS_PROMPT_CORE_PATTERN = '[A-Za-z]:\\\\[^>\\n]*>';
const UNIX_PROMPT_PATTERN = new RegExp(`^(?:${UNIX_PROMPT_CORE_PATTERN}\\s*)+$`);
const WINDOWS_PROMPT_PATTERN = new RegExp(`^(?:${WINDOWS_PROMPT_CORE_PATTERN}\\s*)+$`);

/**
 * 校验 SSH resize 的 cols/rows（通过后可安全当作正整数使用）
 */
export function isValidSshResizeDims(cols: unknown, rows: unknown): cols is number {
  if (
    typeof cols !== 'number' ||
    typeof rows !== 'number' ||
    !Number.isFinite(cols) ||
    !Number.isFinite(rows)
  ) {
    return false;
  }
  // 拒绝非整数尺寸（避免 setWindow 收到小数）
  if (!Number.isInteger(cols) || !Number.isInteger(rows)) {
    return false;
  }
  return cols > 0 && rows > 0 && cols <= SSH_RESIZE_MAX_COLS && rows <= SSH_RESIZE_MAX_ROWS;
}

/**
 * 判断路径是否为绝对路径（POSIX 或 Windows 盘符）
 */
export function isAbsolutePath(value: string): boolean {
  return /^(\/|[A-Za-z]:[\\/])/.test(value);
}

/**
 * 剥离 ANSI / OSC 控制序列
 */
export function stripTerminalControlSequences(value: string): string {
  return value.replace(OSC_ESCAPE_PATTERN, '').replace(ANSI_ESCAPE_PATTERN, '');
}

/**
 * 从静默执行输出行中提取绝对路径（支持 __NX_PWD__ 前缀）
 */
export function extractAbsolutePathFromSilentLine(line: string): string | null {
  const sanitizedLine = stripTerminalControlSequences(line).trim();
  if (!sanitizedLine) {
    return null;
  }

  const pathCandidate = sanitizedLine.startsWith(SILENT_PWD_PREFIX)
    ? sanitizedLine.slice(SILENT_PWD_PREFIX.length).trim()
    : sanitizedLine;
  return isAbsolutePath(pathCandidate) ? pathCandidate : null;
}

/**
 * 输出是否包含绝对路径行
 */
export function hasAbsolutePathInOutput(output: string): boolean {
  return output
    .replace(/\r/g, '')
    .split('\n')
    .some((line) => Boolean(extractAbsolutePathFromSilentLine(line)));
}

/**
 * 规范化 successCriteria 入参
 */
export function normalizeSilentExecSuccessCriteria(value: unknown): SilentExecSuccessCriteria {
  if (value === 'any' || value === 'non_empty' || value === 'absolute_path') {
    return value;
  }
  return 'non_empty';
}

/**
 * 按成功策略判定输出是否可接受
 */
export function isSilentExecOutputAccepted(
  criteria: SilentExecSuccessCriteria,
  output: string,
): boolean {
  if (criteria === 'any') {
    return true;
  }
  if (criteria === 'absolute_path') {
    return hasAbsolutePathInOutput(output);
  }
  return output.trim().length > 0;
}

/**
 * 判断一行是否像 shell 提示符
 */
export function isLikelyShellPromptLine(line: string): boolean {
  const sanitizedLine = stripTerminalControlSequences(line).trim();
  if (!sanitizedLine) {
    return false;
  }
  return UNIX_PROMPT_PATTERN.test(sanitizedLine) || WINDOWS_PROMPT_PATTERN.test(sanitizedLine);
}

/**
 * 静默执行后抑制首行提示符输出
 */
export function consumeSuppressedPromptChunk(chunk: string): {
  output: string;
  consumedPrompt: boolean;
  keepSuppression: boolean;
} {
  const normalizedChunk = chunk.replace(/\r/g, '');
  if (!normalizedChunk) {
    return { output: '', consumedPrompt: false, keepSuppression: true };
  }

  const lineBreakIndex = normalizedChunk.indexOf('\n');
  if (lineBreakIndex === -1) {
    if (isLikelyShellPromptLine(normalizedChunk)) {
      return { output: '', consumedPrompt: true, keepSuppression: false };
    }
    const hasVisibleText = stripTerminalControlSequences(normalizedChunk).trim().length > 0;
    return {
      output: chunk,
      consumedPrompt: false,
      keepSuppression: !hasVisibleText,
    };
  }

  const firstLine = normalizedChunk.slice(0, lineBreakIndex);
  if (!isLikelyShellPromptLine(firstLine)) {
    const hasVisibleText = stripTerminalControlSequences(firstLine).trim().length > 0;
    return {
      output: chunk,
      consumedPrompt: false,
      keepSuppression: !hasVisibleText,
    };
  }

  return {
    output: normalizedChunk.slice(lineBreakIndex + 1),
    consumedPrompt: true,
    keepSuppression: false,
  };
}

/**
 * 从 SSH 输入 payload 解析字符串数据
 */
export function resolveSshInputData(payload: string | { data?: string } | unknown): string | null {
  if (typeof payload === 'string') {
    return payload;
  }
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const data = (payload as { data?: unknown }).data;
    return typeof data === 'string' ? data : null;
  }
  return null;
}
